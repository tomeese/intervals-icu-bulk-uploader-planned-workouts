# ddb.py
# DynamoDB repository for user profile/settings and simple plan index

import os
from typing import Optional, List, Dict

import boto3
from pydantic import BaseModel

_DDB_TABLE = os.environ.get("DDB_TABLE", "intervals_app")
ddb = boto3.resource("dynamodb")
_table = ddb.Table(_DDB_TABLE)

PARTITION_FMT = "USER#{}"


class UserProfile(BaseModel):
    sub: str
    email: Optional[str] = None
    timezone: Optional[str] = None
    ftp_indoor: Optional[int] = None
    ftp_outdoor: Optional[int] = None
    created_at: Optional[str] = None


class PlanIndex(BaseModel):
    sub: str
    plan_id: str
    status: str  # draft|final
    s3_key: str
    labels: Optional[Dict[str, str]] = None
    created_at: Optional[str] = None


def put_user_profile(p: UserProfile):
    item = {
        "PK": PARTITION_FMT.format(p.sub),
        "SK": "PROFILE",
        **{k: v for k, v in p.model_dump().items() if v is not None},
    }
    _table.put_item(Item=item)


def get_user_profile(sub: str) -> Optional[dict]:
    r = _table.get_item(Key={"PK": PARTITION_FMT.format(sub), "SK": "PROFILE"})
    return r.get("Item")


def upsert_plan_index(idx: PlanIndex):
    item = {
        "PK": PARTITION_FMT.format(idx.sub),
        "SK": f"PLAN#{idx.plan_id}",
        **{k: v for k, v in idx.model_dump().items() if v is not None},
    }
    _table.put_item(Item=item)


def list_plans(sub: str, status: Optional[str] = None) -> List[dict]:
    r = _table.query(
        KeyConditionExpression="#pk = :pk AND begins_with(#sk, :skprefix)",
        ExpressionAttributeNames={"#pk": "PK", "#sk": "SK"},
        ExpressionAttributeValues={":pk": PARTITION_FMT.format(sub), ":skprefix": "PLAN#"},
    )
    items = r.get("Items", [])
    if status:
        items = [i for i in items if i.get("status") == status]
    return items
