"""CSVAT — Auth API router."""

from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, HTTPException
from jose import jwt
from app.config import get_settings
from app.schemas import TokenRequest, TokenResponse

router = APIRouter(prefix="/api/v1/auth", tags=["Authentication"])
settings = get_settings()


@router.post("/token", response_model=TokenResponse)
async def get_token(request: TokenRequest):
    """Generate a JWT token for API access.

    In MVP, any non-empty API key is accepted.
    In production, validate against CoRE Stack authentication.
    """
    if not request.api_key:
        raise HTTPException(status_code=401, detail="API key is required")

    # For MVP, accept any key. Production: validate against CoRE Stack.
    payload = {
        "sub": "csvat_user",
        "api_key": request.api_key[:8] + "...",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=settings.JWT_EXPIRY_MINUTES),
        "iat": datetime.now(timezone.utc),
    }
    token = jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
    return TokenResponse(access_token=token)
