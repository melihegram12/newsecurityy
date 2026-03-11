import hashlib

from django.conf import settings
from django.utils import timezone
from rest_framework import authentication
from rest_framework.exceptions import AuthenticationFailed

from .models import DeviceSession


class DevicePrincipal:
    """
    DRF'nin IsAuthenticated permission'ı ile uyumlu bir "user" wrapper'ı.
    """

    def __init__(self, device, session):
        self.device = device
        self.session = session

    @property
    def is_authenticated(self):  # noqa: D401 (DRF expects attribute-like)
        return True

    def __str__(self):
        return f'device:{self.device.device_id}'


def hash_token(token: str) -> str:
    return hashlib.sha256(f'{settings.SECRET_KEY}:{token}'.encode('utf-8')).hexdigest()


class DeviceAuthentication(authentication.BaseAuthentication):
    """
    Authorization: Device <token>
    """

    keyword = 'Device'

    def authenticate(self, request):
        raw = request.META.get('HTTP_AUTHORIZATION', '') or ''
        if not raw:
            return None

        parts = raw.split(' ', 1)
        if len(parts) != 2 or parts[0].lower() != self.keyword.lower():
            return None

        token = parts[1].strip()
        if not token:
            raise AuthenticationFailed('Missing device token')

        token_hash = hash_token(token)
        now = timezone.now()
        session = (
            DeviceSession.objects.select_related('device', 'device__gate', 'device__gate__site')
            .filter(token_hash=token_hash, revoked_at__isnull=True, expires_at__gt=now)
            .first()
        )
        if not session:
            raise AuthenticationFailed('Invalid or expired device token')

        # Keep this lightweight; update last_seen_at only when needed.
        if not session.last_seen_at or (now - session.last_seen_at).total_seconds() > 60:
            DeviceSession.objects.filter(id=session.id).update(last_seen_at=now)

        return DevicePrincipal(session.device, session), session

