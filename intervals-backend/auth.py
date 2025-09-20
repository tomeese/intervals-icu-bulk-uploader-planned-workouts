# auth.py
# Cognito JWT verification (ID token) for Lambda Function URL (no API Gateway authorizer needed)

import os
import time
from typing import Optional

import httpx
import jwt as pyjwt
from fastapi import HTTPException, Header
from jwcrypto import jwk

COGNITO_ISSUER = os.environ.get("COGNITO_ISSUER", "")
COGNITO_AUDIENCE = os.environ.get("COGNITO_AUDIENCE", "")

_JWKS_CACHE = {"exp": 0, "keys": None}


async def _get_jwks():
    now = int(time.time())
    if _JWKS_CACHE["exp"] > now and _JWKS_CACHE["keys"]:
        return _JWKS_CACHE["keys"]
    url = f"{COGNITO_ISSUER}/.well-known/jwks.json"
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(url)
        r.raise_for_status()
        keys = r.json()
    _JWKS_CACHE["keys"] = keys
    _JWKS_CACHE["exp"] = now + 3600  # cache 1 hour
    return keys


async def get_current_user(Authorization: Optional[str] = Header(None)):
    if not Authorization or not Authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = Authorization.split(" ", 1)[1]

    # Decode header to find kid
    try:
        headers = pyjwt.get_unverified_header(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token header")

    jwks = await _get_jwks()
    kid = headers.get("kid")
    key_json = next((k for k in jwks.get("keys", []) if k.get("kid") == kid), None)
    if not key_json:
        raise HTTPException(status_code=401, detail="Unknown key id")

    key = jwk.JWK(**key_json)
    public_key_pem = key.export_to_pem()

    try:
        payload = pyjwt.decode(
            token,
            public_key_pem,
            algorithms=["RS256"],
            audience=COGNITO_AUDIENCE,
            issuer=COGNITO_ISSUER,
        )
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"JWT verify failed: {e}")

    # Expected claims: sub, email, exp, iss, aud
    return {
        "sub": payload.get("sub"),
        "email": payload.get("email"),
        "claims": payload,
    }
