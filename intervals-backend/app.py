# app.py
# FastAPI on AWS Lambda (Function URL) using Mangum
# Endpoints:
# - GET  /health                  -> public health check
# - GET  /me                      -> returns signed-in user's profile (JWT required)
# - POST /me/settings             -> upsert user profile/settings (JWT required)
# - POST /plans/draft             -> store draft JSON to S3 + index in DynamoDB (JWT required)
# - POST /plans/finalize          -> move draft -> final in S3 + update index (JWT required)
# - GET  /plans/{plan_id}         -> fetch final or draft by id from S3 (JWT required)
# - GET  /plans/list              -> list indexed plans for the user (JWT required)
# - POST /intervals/upload        -> proxy bulk upsert to Intervals.icu (JWT required)

import base64
import boto3
import datetime as dt
import hashlib
import hmac
import json
import os
import re
from typing import List, Optional

import httpx
import fastapi
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from mangum import Mangum
from pydantic import BaseModel, Field

from auth import get_current_user
from ddb import (
    UserProfile,
    PlanIndex,
    upsert_plan_index,
    get_user_profile,
    put_user_profile,
    list_plans,
)

# --------- Config (env) ---------
BUCKET = os.environ.get("BUCKET_NAME")  # e.g., intervals-plans-prod
REGION = os.environ.get("AWS_REGION", "us-west-2")
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")  # SPA origin for CORS
DDB_TABLE = os.environ.get("DDB_TABLE", "intervals_app")

# SSM parameter names for secrets (MVP uses a shared Intervals key)
HMAC_PARAM = os.environ.get("HMAC_PARAM", "/intervals/HMAC_SECRET")  # legacy; unused in multi-user
INTERVALS_KEY_PARAM = os.environ.get("INTERVALS_KEY_PARAM", "/intervals/INTERVALS_API_KEY")
GITHUB_TOKEN_PARAM = os.environ.get("GITHUB_TOKEN_PARAM", "/intervals/GH_TOKEN")

s3 = boto3.client("s3", region_name=REGION)
ssm = boto3.client("ssm", region_name=REGION)

app = FastAPI(title="Intervals Upload Backend", version="0.2.0")


# --------- Helpers ---------
def get_ssm_param(name: str, decrypt: bool = True) -> str:
    r = ssm.get_parameter(Name=name, WithDecryption=decrypt)
    return r["Parameter"]["Value"]


def make_id(prefix: str = "plan") -> str:
    t = dt.datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    return f"{prefix}-{t}"


def s3_put_json(key: str, obj: dict) -> None:
    s3.put_object(
        Bucket=BUCKET,
        Key=key,
        Body=json.dumps(obj, separators=(",", ":")).encode("utf-8"),
        ContentType="application/json",
    )


def s3_get_json(key: str) -> dict:
    try:
        r = s3.get_object(Bucket=BUCKET, Key=key)
        return json.loads(r["Body"].read())
    except s3.exceptions.NoSuchKey:
        raise HTTPException(status_code=404, detail="Not found")


def s3_copy(src: str, dest: str) -> None:
    # Requires s3:GetObject on src and s3:PutObject on dest
    s3.copy_object(
        Bucket=BUCKET,
        CopySource={"Bucket": BUCKET, "Key": src},
        Key=dest,
        ContentType="application/json",
        MetadataDirective="REPLACE",
    )


def s3_delete(key: str) -> None:
    s3.delete_object(Bucket=BUCKET, Key=key)


# --------- Models ---------
class PlanPayload(BaseModel):
    week_start: str = Field(..., description="ISO date string (Monday of the plan week)")
    data: dict = Field(..., description="Plan JSON blob (your existing structure)")


class FinalizeRequest(BaseModel):
    plan_id: str
    final_name: Optional[str] = None  # e.g., 2025-10-13


class IntervalsEvent(BaseModel):
    category: str = Field("WORKOUT")
    type: str  # Ride/Run/Swim/Workout
    start_date_local: str  # local ISO without trailing Z
    moving_time: int  # seconds
    icu_training_load: Optional[int] = None
    description: Optional[str] = None
    external_id: Optional[str] = None


class IntervalsUploadRequest(BaseModel):
    events: List[IntervalsEvent]


class MeSettings(BaseModel):
    timezone: Optional[str] = None
    ftp_indoor: Optional[int] = None
    ftp_outdoor: Optional[int] = None


# --------- CORS (app-level; Function URL CORS is also configured) ---------
@app.middleware("http")
async def cors_middleware(request: Request, call_next):
    if request.method == "OPTIONS":
        # Minimal preflight response; Function URL also sets CORS headers
        resp = JSONResponse({"ok": True})
    else:
        resp = await call_next(request)
    resp.headers["Access-Control-Allow-Origin"] = ALLOWED_ORIGIN
    resp.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST"
    return resp


# --------- Routes ---------
@app.get("/health")
async def health():
    return {"ok": True, "ts": dt.datetime.utcnow().isoformat()}


@app.get("/me")
async def me(user=fastapi.Depends(get_current_user)):
    prof = get_user_profile(user["sub"]) or {}
    return {"sub": user["sub"], "email": user.get("email"), "profile": prof}


@app.post("/me/settings")
async def me_settings(body: MeSettings, user=fastapi.Depends(get_current_user)):
    now = dt.datetime.utcnow().isoformat()
    merged = UserProfile(
        sub=user["sub"],
        email=user.get("email"),
        created_at=now,
        **body.model_dump(exclude_none=True),
    )
    put_user_profile(merged)
    return {"ok": True}


@app.post("/plans/draft")
async def create_draft(request: Request, user=fastapi.Depends(get_current_user)):
    body = await request.body()
    payload = PlanPayload.model_validate_json(body)
    plan_id = make_id("plan")
    key = f"plans/{user['sub']}/drafts/{plan_id}.json"
    s3_put_json(key, payload.model_dump())
    upsert_plan_index(
        PlanIndex(
            sub=user["sub"],
            plan_id=plan_id,
            status="draft",
            s3_key=key,
            created_at=dt.datetime.utcnow().isoformat(),
        )
    )
    return {"ok": True, "plan_id": plan_id, "s3_key": key}


@app.post("/plans/finalize")
async def finalize_plan(request: Request, user=fastapi.Depends(get_current_user)):
    body = await request.body()
    req = FinalizeRequest.model_validate_json(body)
    src = f"plans/{user['sub']}/drafts/{req.plan_id}.json"
    final_name = req.final_name or dt.date.today().isoformat()
    safe_name = re.sub(r"[^A-Za-z0-9._-]", "-", final_name)
    dest = f"plans/{user['sub']}/{safe_name}.json"
    s3_copy(src, dest)
    s3_delete(src)
    upsert_plan_index(
        PlanIndex(
            sub=user["sub"],
            plan_id=req.plan_id,
            status="final",
            s3_key=dest,
            created_at=dt.datetime.utcnow().isoformat(),
        )
    )
    return {"ok": True, "final_key": dest}


@app.get("/plans/{plan_id}")
async def get_plan(plan_id: str, user=fastapi.Depends(get_current_user)):
    # Try final then draft path for this user
    try:
        return s3_get_json(f"plans/{user['sub']}/{plan_id}.json")
    except HTTPException:
        return s3_get_json(f"plans/{user['sub']}/drafts/{plan_id}.json")


@app.get("/plans/list")
async def plans_list(status: Optional[str] = None, user=fastapi.Depends(get_current_user)):
    items = list_plans(user["sub"], status=status)
    return {"items": items}


@app.post("/intervals/upload")
async def intervals_upload(request: Request, user=fastapi.Depends(get_current_user)):
    body = await request.body()
    req = IntervalsUploadRequest.model_validate_json(body)

    # MVP: shared Intervals API key in SSM (server-side only)
    api_key = get_ssm_param(INTERVALS_KEY_PARAM)
    basic = base64.b64encode(f"API_KEY:{api_key}".encode("utf-8")).decode("ascii")

    url = "https://intervals.icu/api/v1/athlete/0/events/bulk?upsert=true"
    events = [e.model_dump() for e in req.events]

    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.post(
            url,
            headers={"Authorization": f"Basic {basic}", "Content-Type": "application/json"},
            json=events,
        )

    try:
        data = r.json()
    except Exception:
        data = {"text": r.text}

    if r.status_code >= 300:
        raise HTTPException(status_code=r.status_code, detail=data)

    return {"ok": True, "intervals_response": data}


# --------- Handler (Lambda entrypoint) ---------
handler = Mangum(app)
