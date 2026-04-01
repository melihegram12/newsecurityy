from datetime import date, datetime, time, timedelta
from decimal import Decimal
import unicodedata

from django.conf import settings
from django.contrib.auth import authenticate
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework import generics
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.tokens import RefreshToken

from .authentication import DeviceAuthentication
from .models import (
    AbsenceRecord,
    AbsenceType,
    AccessEvent,
    AuditLog,
    Badge,
    Device,
    DeviceSession,
    HostPreset,
    Person,
    PayrollProfile,
    SecurityLog,
    ShiftAssignment,
    UserRole,
    VehiclePreset,
    WorkShift,
)
from .serializers import (
    AbsenceRecordSerializer,
    AbsenceTypeSerializer,
    AccessEventSerializer,
    AuditLogSerializer,
    BadgeSerializer,
    CheckRequestSerializer,
    DeviceAuthRequestSerializer,
    HostPresetSerializer,
    LogSyncSerializer,
    PersonSerializer,
    PayrollProfileSerializer,
    SecurityLogSerializer,
    ShiftAssignmentSerializer,
    VehiclePresetSerializer,
    WorkShiftSerializer,
)


ROLE_ADMIN = 'ADMIN'
ROLE_SECURITY = 'SECURITY'
ROLE_HR = 'HR'
ROLE_MANAGER = 'MANAGER'
ROLE_ACCOUNTING = 'ACCOUNTING'
ROLE_DEVELOPER = 'DEVELOPER'


def _user_is_authenticated(user):
    return bool(user and getattr(user, 'is_authenticated', False))


def _user_has_role(user, codes):
    if not _user_is_authenticated(user):
        return False
    if getattr(user, 'is_superuser', False):
        return True
    if isinstance(codes, str):
        codes = [codes]
    return UserRole.objects.filter(user=user, role__code__in=codes, role__is_active=True).exists()


def _require_role(user, codes):
    if not _user_has_role(user, codes):
        raise PermissionDenied('Yetkiniz yok.')


def _extract_role_codes(user):
    if not _user_is_authenticated(user):
        return []
    return sorted(
        set(
            UserRole.objects.filter(user=user, role__is_active=True).values_list('role__code', flat=True)
        )
    )


def _auth_payload(user, active_role=''):
    roles = _extract_role_codes(user)
    resolved_active_role = active_role or (roles[0] if roles else '')
    return {
        'id': user.id,
        'username': getattr(user, 'username', ''),
        'email': getattr(user, 'email', ''),
        'is_superuser': bool(getattr(user, 'is_superuser', False)),
        'roles': roles,
        'active_role': resolved_active_role,
    }


def _text_key(value):
    raw = (value or '').strip()
    if not raw:
        return ''
    folded = raw.casefold()
    # Normalize Turkish dotted i (İ -> i + combining dot) and other marks.
    norm = unicodedata.normalize('NFKD', folded)
    return ''.join(ch for ch in norm if not unicodedata.combining(ch))


def _normalize_login_username(username):
    raw = (username or '').strip()
    if not raw:
        return ''

    key = _text_key(raw)
    alias_map = {
        _text_key('Güvenlik Personeli'): 'güvenlik_personeli',
        _text_key('Guvenlik Personeli'): 'güvenlik_personeli',
        _text_key('security'): 'güvenlik_personeli',
        _text_key('guvenlik_personeli'): 'güvenlik_personeli',
        _text_key('güvenlik_personeli'): 'güvenlik_personeli',
        _text_key('İnsan Kaynakları'): 'insan_kaynakları',
        _text_key('Insan Kaynaklari'): 'insan_kaynakları',
        _text_key('İK'): 'insan_kaynakları',
        _text_key('IK'): 'insan_kaynakları',
        _text_key('hr'): 'insan_kaynakları',
        _text_key('insan_kaynaklari'): 'insan_kaynakları',
        _text_key('insan_kaynakları'): 'insan_kaynakları',
        _text_key('Geliştirici'): 'geliştirici',
        _text_key('Gelistirici'): 'geliştirici',
        _text_key('developer'): 'geliştirici',
        _text_key('gelistirici'): 'geliştirici',
        _text_key('geliştirici'): 'geliştirici',
    }
    return alias_map.get(key, raw)


def _audit(request, action, object_type='', object_id='', message=''):
    user = request.user if request and _user_is_authenticated(request.user) else None
    ip = ''
    if request:
        ip = request.META.get('REMOTE_ADDR', '') or ''
    AuditLog.objects.create(
        actor_user=user,
        action=action,
        object_type=object_type,
        object_id=str(object_id) if object_id else '',
        message=message,
        ip_address=ip or None,
    )


def _decimal(value):
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except (TypeError, ValueError):
        return None


def _duration_from_record(record):
    unit = record.duration_unit
    value = _decimal(record.duration_value)
    hours = None
    days = None
    if unit == AbsenceType.DurationUnit.HOURLY:
        if value is None and record.start_at and record.end_at:
            diff = (record.end_at - record.start_at).total_seconds() / 3600
            value = Decimal(f'{max(diff, 0):.2f}')
        hours = value or Decimal('0')
        days = None
    else:
        if value is None:
            value = Decimal('1') if unit == AbsenceType.DurationUnit.FULL_DAY else Decimal('0.5')
        days = value
        hours = None
    return unit, value, hours, days

LOG_FIELDS = {
    'event_type',
    'type',
    'sub_category',
    'shift',
    'plate',
    'driver',
    'name',
    'host',
    'note',
    'location',
    'entry_location',
    'exit_location',
    'seal_number',
    'seal_number_entry',
    'seal_number_exit',
    'tc_no',
    'phone',
    'user_email',
    'created_at',
    'exit_at',
}

LOG_STRING_FIELDS = {
    'event_type',
    'type',
    'sub_category',
    'shift',
    'plate',
    'driver',
    'name',
    'host',
    'note',
    'location',
    'entry_location',
    'exit_location',
    'seal_number',
    'seal_number_entry',
    'seal_number_exit',
    'tc_no',
    'phone',
    'user_email',
}


def _parse_dt(value):
    if not value:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        dt = parse_datetime(value)
    if not dt:
        return None
    if timezone.is_naive(dt):
        dt = timezone.make_aware(dt, timezone.get_current_timezone())
    return dt


def _extract_log_fields(data):
    payload = {}
    if not isinstance(data, dict):
        return payload
    for key in LOG_FIELDS:
        if key in data:
            value = data[key]
            if key in LOG_STRING_FIELDS and value is None:
                value = ''
            payload[key] = value
    if 'created_at' in payload:
        payload['created_at'] = _parse_dt(payload.get('created_at'))
    if 'exit_at' in payload:
        payload['exit_at'] = _parse_dt(payload.get('exit_at'))
    return payload


def _resolve_created_at(payload, local_id=None):
    created_at = payload.get('created_at')
    if not created_at and local_id:
        created_at = _parse_dt(local_id)
    return created_at


class DeviceAuthView(APIView):
    """
    POST /api/device/auth
    Body: { "device_id": "...", "device_key": "..." }

    Cevap: { token, expires_at, device: {...} }
    """

    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        req = DeviceAuthRequestSerializer(data=request.data)
        req.is_valid(raise_exception=True)
        device_id = req.validated_data['device_id']
        device_key = req.validated_data['device_key']

        device = (
            Device.objects.select_related('gate', 'gate__site')
            .filter(device_id=device_id, is_active=True, gate__is_active=True, gate__site__is_active=True)
            .first()
        )
        if not device or not device.check_device_key(device_key):
            return Response({'detail': 'Invalid device credentials'}, status=status.HTTP_401_UNAUTHORIZED)

        session, token = DeviceSession.issue_token(device=device, ttl_days=30)
        return Response(
            {
                'token': token,
                'expires_at': session.expires_at,
                'device': {
                    'id': str(device.id),
                    'device_id': device.device_id,
                    'name': device.name,
                    'gate_id': str(device.gate_id),
                    'site_id': str(device.gate.site_id),
                },
            },
            status=status.HTTP_200_OK,
        )


class AuthLoginView(APIView):
    """
    POST /api/auth/login
    Body: { username, password, role }
    """

    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        username = (request.data.get('username') or '').strip() if isinstance(request.data, dict) else ''
        username = _normalize_login_username(username)
        password = (request.data.get('password') or '') if isinstance(request.data, dict) else ''
        requested_role = (request.data.get('role') or '').strip().upper() if isinstance(request.data, dict) else ''

        if not username or not password or not requested_role:
            return Response({'detail': 'username, password ve role gerekli.'}, status=status.HTTP_400_BAD_REQUEST)

        allowed_roles = {ROLE_SECURITY, ROLE_HR, ROLE_DEVELOPER}
        if requested_role not in allowed_roles:
            return Response({'detail': 'Geçersiz rol.'}, status=status.HTTP_400_BAD_REQUEST)

        user = authenticate(request, username=username, password=password)
        if not user or not user.is_active:
            return Response({'detail': 'Kullanıcı adı veya şifre hatalı.'}, status=status.HTTP_401_UNAUTHORIZED)

        user_roles = _extract_role_codes(user)
        if not user.is_superuser and requested_role not in user_roles:
            return Response(
                {
                    'detail': 'Bu rol ile giriş yetkiniz yok.',
                    'available_roles': user_roles,
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        refresh = RefreshToken.for_user(user)
        payload = _auth_payload(user, requested_role)
        _audit(request, 'auth.login', 'user', user.id, f'role={requested_role}')
        return Response(
            {
                'access': str(refresh.access_token),
                'refresh': str(refresh),
                'user': payload,
            },
            status=status.HTTP_200_OK,
        )


class AuthMeView(APIView):
    """
    GET /api/auth/me?role=SECURITY|HR|DEVELOPER
    """

    permission_classes = [IsAuthenticated]
    authentication_classes = [JWTAuthentication]

    def get(self, request):
        user = request.user
        requested_role = (request.query_params.get('role') or '').strip().upper()
        roles = _extract_role_codes(user)
        if requested_role and not user.is_superuser and requested_role not in roles:
            return Response({'detail': 'Bu rol ile erişim yetkiniz yok.'}, status=status.HTTP_403_FORBIDDEN)

        active_role = requested_role or (roles[0] if roles else '')
        return Response(_auth_payload(user, active_role), status=status.HTTP_200_OK)


class AuditLogListView(APIView):
    """
    GET /api/auth/audit?limit=200
    """

    permission_classes = [IsAuthenticated]
    authentication_classes = [JWTAuthentication]

    def get(self, request):
        _require_role(request.user, [ROLE_DEVELOPER, ROLE_ADMIN])

        limit_raw = request.query_params.get('limit', '200')
        try:
            limit = min(max(int(limit_raw), 1), 1000)
        except (TypeError, ValueError):
            return Response({'detail': 'limit hatali'}, status=status.HTTP_400_BAD_REQUEST)

        qs = AuditLog.objects.select_related('actor_user', 'actor_device').order_by('-created_at')[:limit]
        return Response(AuditLogSerializer(qs, many=True).data, status=status.HTTP_200_OK)


class CheckView(APIView):
    """
    POST /api/check
    Headers: Authorization: Device <token>
    """

    authentication_classes = [DeviceAuthentication]
    permission_classes = [IsAuthenticated]

    def post(self, request):
        req = CheckRequestSerializer(data=request.data)
        req.is_valid(raise_exception=True)
        data = req.validated_data

        device = request.user.device
        gate = device.gate
        site = gate.site

        client_event_uuid = data['client_event_uuid']
        direction = data['direction']
        badge_code = (data.get('badge_code') or '').strip()
        person_id = data.get('person_id')
        person_input = data.get('person') or None
        note = data.get('note', '')
        metadata = data.get('metadata', {})

        with transaction.atomic():
            existing = AccessEvent.objects.filter(client_event_uuid=client_event_uuid).select_related(
                'person', 'badge', 'site', 'gate', 'device'
            ).first()
            if existing:
                payload = AccessEventSerializer(existing).data
                payload['duplicate'] = True
                return Response(payload, status=status.HTTP_200_OK)

            badge = None
            person = None

            if person_id:
                person = Person.objects.select_for_update().get(id=person_id)
            elif badge_code:
                badge = Badge.objects.select_related('person').filter(code=badge_code, is_active=True).first()
                if badge:
                    person = Person.objects.select_for_update().get(id=badge.person_id)
                elif person_input:
                    person = Person.objects.create(
                        kind=person_input['kind'],
                        full_name=person_input['full_name'],
                        tc_no=(person_input.get('tc_no') or ''),
                        phone=(person_input.get('phone') or ''),
                    )
                    badge = Badge.objects.create(person=person, code=badge_code)
                else:
                    return Response(
                        {'detail': 'Badge bulunamadi ve person bilgisi gonderilmedi.'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
            else:
                # person_input var ama badge_code yok.
                person = Person.objects.create(
                    kind=person_input['kind'],
                    full_name=person_input['full_name'],
                    tc_no=(person_input.get('tc_no') or ''),
                    phone=(person_input.get('phone') or ''),
                )

            if direction == AccessEvent.Direction.IN and person.is_inside:
                return Response(
                    {'code': 'ALREADY_INSIDE', 'detail': 'Kisi zaten iceride.'},
                    status=status.HTTP_409_CONFLICT,
                )
            if direction == AccessEvent.Direction.OUT and not person.is_inside:
                return Response(
                    {'code': 'NOT_INSIDE', 'detail': 'Kisi iceride degil.'},
                    status=status.HTTP_409_CONFLICT,
                )

            try:
                event = AccessEvent.objects.create(
                    client_event_uuid=client_event_uuid,
                    site=site,
                    gate=gate,
                    device=device,
                    person=person,
                    badge=badge,
                    direction=direction,
                    note=note,
                    metadata=metadata,
                )
            except IntegrityError:
                # Very rare: concurrent duplicate client_event_uuid
                event = AccessEvent.objects.get(client_event_uuid=client_event_uuid)
                payload = AccessEventSerializer(event).data
                payload['duplicate'] = True
                return Response(payload, status=status.HTTP_200_OK)

            person.is_inside = direction == AccessEvent.Direction.IN
            person.save(update_fields=['is_inside', 'updated_at'])

        event = AccessEvent.objects.select_related('person', 'badge', 'site', 'gate', 'device').get(id=event.id)
        payload = AccessEventSerializer(event).data
        payload['duplicate'] = False
        return Response(payload, status=status.HTTP_201_CREATED)


class LogSyncView(APIView):
    """
    POST /api/logs/sync
    Body: { action: INSERT|UPDATE|DELETE|EXIT, data: {...}, local_id?: "2026-02-04T10:00:00.000Z" }
    """

    permission_classes = [AllowAny]
    authentication_classes = [JWTAuthentication]

    def post(self, request):
        serializer = LogSyncSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        action = serializer.validated_data['action']
        data = serializer.validated_data.get('data') or {}
        local_id = serializer.validated_data.get('local_id') or None

        # JWT ile gelen kullanıcılar rol bazlı yetkilidir.
        # JWT yoksa cihaz sync için X-Api-Key beklenir (LOCAL_SYNC_API_KEY dolu ise).
        if _user_is_authenticated(request.user):
            _require_role(request.user, [ROLE_SECURITY, ROLE_DEVELOPER, ROLE_ADMIN])
        else:
            expected_key = getattr(settings, 'LOCAL_SYNC_API_KEY', '')
            api_key = request.headers.get('X-Api-Key', '')
            if expected_key:
                if api_key != expected_key:
                    return Response({'detail': 'Unauthorized'}, status=status.HTTP_401_UNAUTHORIZED)
            else:
                # Hard fail in production if LOCAL_SYNC_API_KEY is not configured.
                if not getattr(settings, 'DEBUG', False):
                    return Response({'detail': 'Unauthorized'}, status=status.HTTP_401_UNAUTHORIZED)

        if action == 'INSERT':
            payload = _extract_log_fields(data)
            created_at = _resolve_created_at(payload, local_id) or timezone.now()
            payload['created_at'] = created_at
            obj, created = SecurityLog.objects.update_or_create(created_at=created_at, defaults=payload)
            _audit(
                request,
                'security_log.insert',
                'security_log',
                obj.id,
                f"user_email={payload.get('user_email', '')}",
            )
            return Response(SecurityLogSerializer(obj).data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)

        if action == 'UPDATE':
            payload = _extract_log_fields(data)
            created_at = _resolve_created_at(payload, local_id)
            if not created_at:
                return Response({'detail': 'created_at gerekli'}, status=status.HTTP_400_BAD_REQUEST)
            payload['created_at'] = created_at
            obj, _ = SecurityLog.objects.update_or_create(created_at=created_at, defaults=payload)
            _audit(
                request,
                'security_log.update',
                'security_log',
                obj.id,
                f"user_email={payload.get('user_email', '')}",
            )
            return Response(SecurityLogSerializer(obj).data, status=status.HTTP_200_OK)

        if action == 'DELETE':
            created_at = _resolve_created_at(_extract_log_fields(data), local_id)
            if not created_at:
                return Response({'detail': 'created_at gerekli'}, status=status.HTTP_400_BAD_REQUEST)
            deleted, _ = SecurityLog.objects.filter(created_at=created_at).delete()
            _audit(
                request,
                'security_log.delete',
                'security_log',
                created_at.isoformat(),
                f'deleted={deleted}',
            )
            return Response({'deleted': deleted}, status=status.HTTP_200_OK)

        if action == 'EXIT':
            payload = _extract_log_fields(data)
            created_at = _resolve_created_at(payload, local_id)
            exit_at = _parse_dt(data.get('exit_at')) or timezone.now()
            extra = data.get('extraData') or {}
            extra_payload = _extract_log_fields(extra)
            update_payload = {**extra_payload, 'exit_at': exit_at}
            update_payload.pop('created_at', None)

            plate = (data.get('plate') or '').strip()
            name = (data.get('name') or '').strip()
            if created_at:
                target = SecurityLog.objects.filter(created_at=created_at).first()
            else:
                if not plate and not name:
                    return Response({'detail': 'created_at veya plate veya name gerekli'}, status=status.HTTP_400_BAD_REQUEST)

                qs = SecurityLog.objects.filter(exit_at__isnull=True)
                if plate:
                    qs = qs.filter(plate=plate)
                else:
                    qs = qs.filter(name=name)

                target = qs.order_by('-created_at').first()
            if not target:
                return Response({'detail': 'Kayit bulunamadi'}, status=status.HTTP_404_NOT_FOUND)

            for key, value in update_payload.items():
                setattr(target, key, value)
            update_fields = list(update_payload.keys())
            target.save(update_fields=update_fields)
            _audit(
                request,
                'security_log.exit',
                'security_log',
                target.id,
                f"plate={target.plate} name={target.name}",
            )
            return Response(SecurityLogSerializer(target).data, status=status.HTTP_200_OK)

        return Response({'detail': 'Bilinmeyen action'}, status=status.HTTP_400_BAD_REQUEST)


class LogListView(APIView):
    """
    GET /api/logs
    Query params:
      - days: son N gun (created_at >= now - days)
      - since: ISO datetime (created_at > since)
      - date_from, date_to: tarih veya datetime
      - limit: max kayit (default 5000)
    """

    permission_classes = [AllowAny]
    authentication_classes = [JWTAuthentication]

    def get(self, request):
        if _user_is_authenticated(request.user):
            _require_role(request.user, [ROLE_SECURITY, ROLE_HR, ROLE_DEVELOPER, ROLE_ADMIN])
        else:
            expected_key = getattr(settings, 'LOCAL_SYNC_API_KEY', '')
            api_key = request.headers.get('X-Api-Key', '')
            if expected_key:
                if api_key != expected_key:
                    return Response({'detail': 'Unauthorized'}, status=status.HTTP_401_UNAUTHORIZED)
            else:
                # Hard fail in production if LOCAL_SYNC_API_KEY is not configured.
                if not getattr(settings, 'DEBUG', False):
                    return Response({'detail': 'Unauthorized'}, status=status.HTTP_401_UNAUTHORIZED)

        qs = SecurityLog.objects.all()

        days = request.query_params.get('days')
        since = request.query_params.get('since')
        date_from = request.query_params.get('date_from')
        date_to = request.query_params.get('date_to')
        limit = request.query_params.get('limit')

        if days:
            try:
                days_int = int(days)
                if days_int > 0:
                    qs = qs.filter(created_at__gte=timezone.now() - timedelta(days=days_int))
            except (TypeError, ValueError):
                return Response({'detail': 'days hatali'}, status=status.HTTP_400_BAD_REQUEST)

        if since:
            since_dt = _parse_dt(since)
            if not since_dt:
                return Response({'detail': 'since hatali'}, status=status.HTTP_400_BAD_REQUEST)
            qs = qs.filter(created_at__gt=since_dt)

        if date_from:
            parsed_from = parse_date(date_from) or parse_datetime(date_from)
            if not parsed_from:
                return Response({'detail': 'date_from hatali'}, status=status.HTTP_400_BAD_REQUEST)
            if isinstance(parsed_from, date) and not isinstance(parsed_from, datetime):
                qs = qs.filter(created_at__date__gte=parsed_from)
            else:
                if timezone.is_naive(parsed_from):
                    parsed_from = timezone.make_aware(parsed_from, timezone.get_current_timezone())
                qs = qs.filter(created_at__gte=parsed_from)

        if date_to:
            parsed_to = parse_date(date_to) or parse_datetime(date_to)
            if not parsed_to:
                return Response({'detail': 'date_to hatali'}, status=status.HTTP_400_BAD_REQUEST)
            if isinstance(parsed_to, date) and not isinstance(parsed_to, datetime):
                qs = qs.filter(created_at__date__lte=parsed_to)
            else:
                if timezone.is_naive(parsed_to):
                    parsed_to = timezone.make_aware(parsed_to, timezone.get_current_timezone())
                qs = qs.filter(created_at__lte=parsed_to)

        qs = qs.order_by('created_at')

        safe_limit = 5000
        if limit:
            try:
                limit_int = int(limit)
                if limit_int > 0:
                    safe_limit = min(limit_int, 5000)
            except (TypeError, ValueError):
                return Response({'detail': 'limit hatali'}, status=status.HTTP_400_BAD_REQUEST)

        qs = qs[:safe_limit]
        return Response(SecurityLogSerializer(qs, many=True).data, status=status.HTTP_200_OK)


class PersonListCreateView(generics.ListCreateAPIView):
    serializer_class = PersonSerializer

    def get_queryset(self):
        _require_role(self.request.user, [ROLE_HR, ROLE_ADMIN, ROLE_DEVELOPER])

        qs = Person.objects.all()
        kind = self.request.query_params.get('kind')
        active = self.request.query_params.get('active')
        inside = self.request.query_params.get('inside')
        query = (self.request.query_params.get('q') or '').strip()

        if kind:
            qs = qs.filter(kind=kind)
        if active in ('1', 'true', 'True'):
            qs = qs.filter(is_active=True)
        elif active in ('0', 'false', 'False'):
            qs = qs.filter(is_active=False)
        if inside in ('1', 'true', 'True'):
            qs = qs.filter(is_inside=True)
        elif inside in ('0', 'false', 'False'):
            qs = qs.filter(is_inside=False)
        if query:
            qs = qs.filter(
                Q(full_name__icontains=query)
                | Q(tc_no__icontains=query)
                | Q(phone__icontains=query)
            )

        return qs.order_by('full_name', 'created_at')

    def perform_create(self, serializer):
        _require_role(self.request.user, [ROLE_HR, ROLE_ADMIN, ROLE_DEVELOPER])
        obj = serializer.save()
        _audit(self.request, 'person.create', 'person', obj.id, obj.full_name)


class PersonDetailView(generics.RetrieveUpdateAPIView):
    serializer_class = PersonSerializer

    def get_queryset(self):
        _require_role(self.request.user, [ROLE_HR, ROLE_ADMIN, ROLE_DEVELOPER])
        return Person.objects.all()

    def perform_update(self, serializer):
        _require_role(self.request.user, [ROLE_HR, ROLE_ADMIN, ROLE_DEVELOPER])
        obj = serializer.save()
        _audit(self.request, 'person.update', 'person', obj.id, obj.full_name)


class BadgeListCreateView(generics.ListCreateAPIView):
    serializer_class = BadgeSerializer

    def get_queryset(self):
        _require_role(self.request.user, [ROLE_HR, ROLE_ADMIN, ROLE_DEVELOPER])

        qs = Badge.objects.select_related('person').all()
        person_id = self.request.query_params.get('person_id')
        active = self.request.query_params.get('active')
        query = (self.request.query_params.get('q') or '').strip()

        if person_id:
            qs = qs.filter(person_id=person_id)
        if active in ('1', 'true', 'True'):
            qs = qs.filter(is_active=True)
        elif active in ('0', 'false', 'False'):
            qs = qs.filter(is_active=False)
        if query:
            qs = qs.filter(
                Q(code__icontains=query)
                | Q(person__full_name__icontains=query)
            )

        return qs.order_by('person__full_name', 'code')

    def perform_create(self, serializer):
        _require_role(self.request.user, [ROLE_HR, ROLE_ADMIN, ROLE_DEVELOPER])
        obj = serializer.save()
        _audit(self.request, 'badge.create', 'badge', obj.id, obj.code)


class BadgeDetailView(generics.RetrieveUpdateAPIView):
    serializer_class = BadgeSerializer

    def get_queryset(self):
        _require_role(self.request.user, [ROLE_HR, ROLE_ADMIN, ROLE_DEVELOPER])
        return Badge.objects.select_related('person').all()

    def perform_update(self, serializer):
        _require_role(self.request.user, [ROLE_HR, ROLE_ADMIN, ROLE_DEVELOPER])
        obj = serializer.save()
        _audit(self.request, 'badge.update', 'badge', obj.id, obj.code)


class HostPresetListCreateView(generics.ListCreateAPIView):
    serializer_class = HostPresetSerializer

    def get_queryset(self):
        _require_role(self.request.user, [ROLE_SECURITY, ROLE_HR, ROLE_ADMIN, ROLE_DEVELOPER])

        qs = HostPreset.objects.all()
        active = self.request.query_params.get('active')
        query = (self.request.query_params.get('q') or '').strip()

        if active in ('1', 'true', 'True'):
            qs = qs.filter(is_active=True)
        elif active in ('0', 'false', 'False'):
            qs = qs.filter(is_active=False)
        if query:
            qs = qs.filter(name__icontains=query)

        return qs.order_by('sort_order', 'name')

    def perform_create(self, serializer):
        _require_role(self.request.user, [ROLE_HR, ROLE_ADMIN, ROLE_DEVELOPER])
        obj = serializer.save()
        _audit(self.request, 'host_preset.create', 'host_preset', obj.id, obj.name)


class HostPresetDetailView(generics.RetrieveUpdateAPIView):
    serializer_class = HostPresetSerializer

    def get_queryset(self):
        _require_role(self.request.user, [ROLE_SECURITY, ROLE_HR, ROLE_ADMIN, ROLE_DEVELOPER])
        return HostPreset.objects.all()

    def perform_update(self, serializer):
        _require_role(self.request.user, [ROLE_HR, ROLE_ADMIN, ROLE_DEVELOPER])
        obj = serializer.save()
        _audit(self.request, 'host_preset.update', 'host_preset', obj.id, obj.name)


class VehiclePresetListCreateView(generics.ListCreateAPIView):
    serializer_class = VehiclePresetSerializer

    def get_queryset(self):
        _require_role(self.request.user, [ROLE_SECURITY, ROLE_HR, ROLE_ADMIN, ROLE_DEVELOPER])

        qs = VehiclePreset.objects.all()
        active = self.request.query_params.get('active')
        category = self.request.query_params.get('category')
        query = (self.request.query_params.get('q') or '').strip()

        if active in ('1', 'true', 'True'):
            qs = qs.filter(is_active=True)
        elif active in ('0', 'false', 'False'):
            qs = qs.filter(is_active=False)
        if category:
            qs = qs.filter(category=category)
        if query:
            qs = qs.filter(
                Q(plate__icontains=query)
                | Q(label__icontains=query)
            )

        return qs.order_by('category', 'sort_order', 'plate')

    def perform_create(self, serializer):
        _require_role(self.request.user, [ROLE_HR, ROLE_ADMIN, ROLE_DEVELOPER])
        obj = serializer.save(plate=(serializer.validated_data.get('plate') or '').strip().upper())
        _audit(self.request, 'vehicle_preset.create', 'vehicle_preset', obj.id, obj.display_name)


class VehiclePresetDetailView(generics.RetrieveUpdateAPIView):
    serializer_class = VehiclePresetSerializer

    def get_queryset(self):
        _require_role(self.request.user, [ROLE_SECURITY, ROLE_HR, ROLE_ADMIN, ROLE_DEVELOPER])
        return VehiclePreset.objects.all()

    def perform_update(self, serializer):
        _require_role(self.request.user, [ROLE_HR, ROLE_ADMIN, ROLE_DEVELOPER])
        plate = serializer.validated_data.get('plate')
        save_kwargs = {}
        if plate is not None:
            save_kwargs['plate'] = plate.strip().upper()
        obj = serializer.save(**save_kwargs)
        _audit(self.request, 'vehicle_preset.update', 'vehicle_preset', obj.id, obj.display_name)


class AbsenceTypeListCreateView(generics.ListCreateAPIView):
    serializer_class = AbsenceTypeSerializer

    def get_queryset(self):
        qs = AbsenceType.objects.all()
        active = self.request.query_params.get('active')
        if active in ('1', 'true', 'True'):
            qs = qs.filter(is_active=True)
        return qs.order_by('name')

    def perform_create(self, serializer):
        _require_role(self.request.user, [ROLE_HR, ROLE_ADMIN])
        obj = serializer.save()
        _audit(self.request, 'absence_type.create', 'absence_type', obj.id, f'{obj.code}')


class AbsenceTypeDetailView(generics.RetrieveUpdateAPIView):
    queryset = AbsenceType.objects.all()
    serializer_class = AbsenceTypeSerializer

    def perform_update(self, serializer):
        _require_role(self.request.user, [ROLE_HR, ROLE_ADMIN])
        obj = serializer.save()
        _audit(self.request, 'absence_type.update', 'absence_type', obj.id, f'{obj.code}')


class AbsenceRecordListCreateView(generics.ListCreateAPIView):
    serializer_class = AbsenceRecordSerializer

    def get_queryset(self):
        qs = AbsenceRecord.objects.select_related('person', 'absence_type').all()
        person_id = self.request.query_params.get('person_id')
        type_id = self.request.query_params.get('absence_type_id')
        type_code = self.request.query_params.get('absence_type_code')
        status_value = self.request.query_params.get('status')
        date_from = self.request.query_params.get('date_from')
        date_to = self.request.query_params.get('date_to')

        if person_id:
            qs = qs.filter(person_id=person_id)
        if type_id:
            qs = qs.filter(absence_type_id=type_id)
        if type_code:
            qs = qs.filter(absence_type__code=type_code)
        if status_value:
            qs = qs.filter(status=status_value)

        if date_from:
            parsed_from = parse_date(date_from) or parse_datetime(date_from)
            if parsed_from:
                if isinstance(parsed_from, date) and not isinstance(parsed_from, datetime):
                    qs = qs.filter(start_at__date__gte=parsed_from)
                else:
                    qs = qs.filter(start_at__gte=parsed_from)

        if date_to:
            parsed_to = parse_date(date_to) or parse_datetime(date_to)
            if parsed_to:
                if isinstance(parsed_to, date) and not isinstance(parsed_to, datetime):
                    qs = qs.filter(start_at__date__lte=parsed_to)
                else:
                    qs = qs.filter(start_at__lte=parsed_to)

        return qs.order_by('-start_at')

    def perform_create(self, serializer):
        user = self.request.user
        _require_role(user, [ROLE_HR, ROLE_MANAGER, ROLE_ADMIN])
        start_at = serializer.validated_data.get('start_at')
        if start_at:
            is_backdated = start_at.date() < timezone.localdate()
            if is_backdated and not _user_has_role(user, [ROLE_HR, ROLE_ADMIN]):
                raise PermissionDenied('Geriye dönük kayıt için yetkiniz yok.')
        obj = serializer.save(created_by=user if _user_is_authenticated(user) else None)
        _audit(
            self.request,
            'absence_record.create',
            'absence_record',
            obj.id,
            f'status={obj.status} backdated={start_at.date() < timezone.localdate() if start_at else False}',
        )


class AbsenceRecordDetailView(generics.RetrieveUpdateAPIView):
    queryset = AbsenceRecord.objects.select_related('person', 'absence_type').all()
    serializer_class = AbsenceRecordSerializer

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        user = request.user
        if not _user_has_role(user, [ROLE_HR, ROLE_ADMIN]):
            if not (_user_is_authenticated(user) and instance.created_by_id == user.id):
                raise PermissionDenied('Yetkiniz yok.')
            if instance.status in {AbsenceRecord.Status.APPROVED, AbsenceRecord.Status.REJECTED, AbsenceRecord.Status.CANCELLED}:
                raise PermissionDenied('Onaylanmış/reddedilmiş kaydı güncelleyemezsiniz.')

        start_at = request.data.get('start_at')
        if start_at:
            parsed = parse_date(start_at) or parse_datetime(start_at)
            if parsed and isinstance(parsed, date) and not isinstance(parsed, datetime):
                parsed_date = parsed
            elif parsed:
                parsed_date = parsed.date()
            else:
                parsed_date = None
            if parsed_date and parsed_date < timezone.localdate() and not _user_has_role(user, [ROLE_HR, ROLE_ADMIN]):
                raise PermissionDenied('Geriye dönük kayıt için yetkiniz yok.')

        response = super().update(request, *args, **kwargs)
        _audit(request, 'absence_record.update', 'absence_record', instance.id, f'status={instance.status}')
        return response


class AbsenceRecordManagerApproveView(APIView):
    def post(self, request, pk):
        _require_role(request.user, [ROLE_MANAGER, ROLE_ADMIN, ROLE_HR])
        record = AbsenceRecord.objects.select_related('person', 'absence_type').get(pk=pk)
        if record.status in {AbsenceRecord.Status.REJECTED, AbsenceRecord.Status.CANCELLED}:
            raise ValidationError('Bu kayıt reddedilmiş veya iptal edilmiş.')
        record.manager_approved_by = request.user
        record.manager_approved_at = timezone.now()
        record.status = AbsenceRecord.Status.SUBMITTED
        record.save(update_fields=['manager_approved_by', 'manager_approved_at', 'status', 'updated_at'])
        _audit(request, 'absence_record.approve_manager', 'absence_record', record.id)
        return Response(AbsenceRecordSerializer(record).data, status=status.HTTP_200_OK)


class AbsenceRecordHRApproveView(APIView):
    def post(self, request, pk):
        _require_role(request.user, [ROLE_HR, ROLE_ADMIN])
        record = AbsenceRecord.objects.select_related('person', 'absence_type').get(pk=pk)
        if record.status in {AbsenceRecord.Status.REJECTED, AbsenceRecord.Status.CANCELLED}:
            raise ValidationError('Bu kayıt reddedilmiş veya iptal edilmiş.')
        if not record.manager_approved_at and not _user_has_role(request.user, [ROLE_ADMIN]):
            raise ValidationError('Amir onayı gerekli.')
        now = timezone.now()
        record.hr_approved_by = request.user
        record.hr_approved_at = now
        record.approved_by = request.user
        record.approved_at = now
        record.status = AbsenceRecord.Status.APPROVED
        record.save(update_fields=[
            'hr_approved_by',
            'hr_approved_at',
            'approved_by',
            'approved_at',
            'status',
            'updated_at',
        ])
        _audit(request, 'absence_record.approve_hr', 'absence_record', record.id)
        return Response(AbsenceRecordSerializer(record).data, status=status.HTTP_200_OK)


class AbsenceRecordRejectView(APIView):
    def post(self, request, pk):
        _require_role(request.user, [ROLE_MANAGER, ROLE_HR, ROLE_ADMIN])
        record = AbsenceRecord.objects.select_related('person', 'absence_type').get(pk=pk)
        if record.status in {AbsenceRecord.Status.REJECTED, AbsenceRecord.Status.CANCELLED}:
            raise ValidationError('Bu kayıt zaten reddedilmiş/iptal edilmiş.')
        note = request.data.get('note', '') if isinstance(request.data, dict) else ''
        record.status = AbsenceRecord.Status.REJECTED
        record.rejected_by = request.user
        record.rejected_at = timezone.now()
        if note:
            record.approved_note = note
        record.save(update_fields=['status', 'rejected_by', 'rejected_at', 'approved_note', 'updated_at'])
        _audit(request, 'absence_record.reject', 'absence_record', record.id, note)
        return Response(AbsenceRecordSerializer(record).data, status=status.HTTP_200_OK)


class AbsenceRecordCancelView(APIView):
    def post(self, request, pk):
        record = AbsenceRecord.objects.select_related('person', 'absence_type').get(pk=pk)
        user = request.user
        if not _user_has_role(user, [ROLE_HR, ROLE_ADMIN]):
            if not (_user_is_authenticated(user) and record.created_by_id == user.id):
                raise PermissionDenied('Yetkiniz yok.')
        if record.status in {AbsenceRecord.Status.REJECTED, AbsenceRecord.Status.CANCELLED}:
            raise ValidationError('Bu kayıt reddedilmiş/iptal edilmiş.')
        note = request.data.get('note', '') if isinstance(request.data, dict) else ''
        record.status = AbsenceRecord.Status.CANCELLED
        record.cancelled_by = user if _user_is_authenticated(user) else None
        record.cancelled_at = timezone.now()
        if note:
            record.approved_note = note
        record.save(update_fields=['status', 'cancelled_by', 'cancelled_at', 'approved_note', 'updated_at'])
        _audit(request, 'absence_record.cancel', 'absence_record', record.id, note)
        return Response(AbsenceRecordSerializer(record).data, status=status.HTTP_200_OK)


class WorkShiftListCreateView(generics.ListCreateAPIView):
    serializer_class = WorkShiftSerializer

    def get_queryset(self):
        qs = WorkShift.objects.all()
        active = self.request.query_params.get('active')
        if active in ('1', 'true', 'True'):
            qs = qs.filter(is_active=True)
        return qs.order_by('name')

    def perform_create(self, serializer):
        _require_role(self.request.user, [ROLE_HR, ROLE_ADMIN])
        obj = serializer.save()
        _audit(self.request, 'work_shift.create', 'work_shift', obj.id, f'{obj.code}')


class WorkShiftDetailView(generics.RetrieveUpdateAPIView):
    queryset = WorkShift.objects.all()
    serializer_class = WorkShiftSerializer

    def perform_update(self, serializer):
        _require_role(self.request.user, [ROLE_HR, ROLE_ADMIN])
        obj = serializer.save()
        _audit(self.request, 'work_shift.update', 'work_shift', obj.id, f'{obj.code}')


class ShiftAssignmentListCreateView(generics.ListCreateAPIView):
    serializer_class = ShiftAssignmentSerializer

    def get_queryset(self):
        qs = ShiftAssignment.objects.select_related('person', 'shift').all()
        person_id = self.request.query_params.get('person_id')
        shift_id = self.request.query_params.get('shift_id')
        active = self.request.query_params.get('active')
        if person_id:
            qs = qs.filter(person_id=person_id)
        if shift_id:
            qs = qs.filter(shift_id=shift_id)
        if active in ('1', 'true', 'True'):
            qs = qs.filter(is_active=True)
        return qs.order_by('-effective_from')

    def perform_create(self, serializer):
        _require_role(self.request.user, [ROLE_HR, ROLE_ADMIN])
        obj = serializer.save()
        _audit(self.request, 'shift_assignment.create', 'shift_assignment', obj.id)


class ShiftAssignmentDetailView(generics.RetrieveUpdateAPIView):
    queryset = ShiftAssignment.objects.select_related('person', 'shift').all()
    serializer_class = ShiftAssignmentSerializer

    def perform_update(self, serializer):
        _require_role(self.request.user, [ROLE_HR, ROLE_ADMIN])
        obj = serializer.save()
        _audit(self.request, 'shift_assignment.update', 'shift_assignment', obj.id)


class AttendanceSummaryView(APIView):
    def get(self, request):
        _require_role(request.user, [ROLE_HR, ROLE_MANAGER, ROLE_ADMIN])
        person_id = request.query_params.get('person_id')
        if not person_id:
            raise ValidationError('person_id gerekli.')

        date_from = request.query_params.get('date_from')
        date_to = request.query_params.get('date_to')
        parsed_from = parse_date(date_from) if date_from else timezone.localdate()
        parsed_to = parse_date(date_to) if date_to else parsed_from

        if not parsed_from or not parsed_to:
            raise ValidationError('date_from/date_to hatali.')
        if parsed_to < parsed_from:
            raise ValidationError('date_to, date_from tarihinden once olamaz.')
        if (parsed_to - parsed_from).days > 62:
            raise ValidationError('En fazla 62 gun araliginda rapor alinabilir.')

        person = Person.objects.get(id=person_id)

        tz = timezone.get_current_timezone()
        range_start = datetime.combine(parsed_from, time.min, tzinfo=tz)
        range_end = datetime.combine(parsed_to + timedelta(days=1), time.max, tzinfo=tz)

        events = list(
            AccessEvent.objects.filter(person_id=person_id, created_at__gte=range_start, created_at__lte=range_end)
            .order_by('created_at')
            .only('created_at', 'direction')
        )

        assignments = list(
            ShiftAssignment.objects.select_related('shift')
            .filter(person_id=person_id, is_active=True)
            .order_by('-effective_from')
        )

        def resolve_shift(target_date):
            for assignment in assignments:
                if assignment.effective_from <= target_date and (
                    not assignment.effective_to or assignment.effective_to >= target_date
                ):
                    return assignment.shift
            return None

        def shift_window(target_date, shift):
            start_dt = datetime.combine(target_date, shift.start_time, tzinfo=tz)
            end_date = target_date
            if shift.end_time <= shift.start_time:
                end_date = target_date + timedelta(days=1)
            end_dt = datetime.combine(end_date, shift.end_time, tzinfo=tz)
            return start_dt, end_dt

        days = []
        total_minutes = 0
        total_late = 0
        total_early = 0
        total_absent = 0

        current_date = parsed_from
        while current_date <= parsed_to:
            shift = resolve_shift(current_date)
            if shift:
                window_start, window_end = shift_window(current_date, shift)
            else:
                window_start = datetime.combine(current_date, time.min, tzinfo=tz)
                window_end = datetime.combine(current_date, time.max, tzinfo=tz)

            day_events = [e for e in events if window_start <= e.created_at <= window_end]
            ins = [e.created_at for e in day_events if e.direction == AccessEvent.Direction.IN]
            outs = [e.created_at for e in day_events if e.direction == AccessEvent.Direction.OUT]

            first_in = min(ins) if ins else None
            last_out = max(outs) if outs else None

            minutes = 0
            if first_in and last_out and last_out > first_in:
                minutes = int((last_out - first_in).total_seconds() // 60)

            late_minutes = 0
            early_leave_minutes = 0
            if shift and first_in:
                late_threshold = window_start + timedelta(minutes=shift.late_tolerance_minutes)
                if first_in > late_threshold:
                    late_minutes = int((first_in - late_threshold).total_seconds() // 60)
            if shift and last_out:
                early_threshold = window_end - timedelta(minutes=shift.early_leave_tolerance_minutes)
                if last_out < early_threshold:
                    early_leave_minutes = int((early_threshold - last_out).total_seconds() // 60)

            absent = bool(shift and not ins and not outs)

            total_minutes += minutes
            total_late += late_minutes
            total_early += early_leave_minutes
            total_absent += 1 if absent else 0

            days.append(
                {
                    'date': current_date.isoformat(),
                    'shift': {
                        'id': str(shift.id),
                        'name': shift.name,
                        'code': shift.code,
                        'start_time': shift.start_time.isoformat(),
                        'end_time': shift.end_time.isoformat(),
                    } if shift else None,
                    'first_in': first_in.isoformat() if first_in else None,
                    'last_out': last_out.isoformat() if last_out else None,
                    'total_minutes': minutes,
                    'late_minutes': late_minutes,
                    'early_leave_minutes': early_leave_minutes,
                    'absent': absent,
                }
            )

            current_date = current_date + timedelta(days=1)

        return Response(
            {
                'person': {'id': str(person.id), 'full_name': person.full_name},
                'date_from': parsed_from.isoformat(),
                'date_to': parsed_to.isoformat(),
                'days': days,
                'totals': {
                    'total_minutes': total_minutes,
                    'late_minutes': total_late,
                    'early_leave_minutes': total_early,
                    'absent_days': total_absent,
                },
            }
        )


class PayrollProfileListCreateView(generics.ListCreateAPIView):
    serializer_class = PayrollProfileSerializer

    def get_queryset(self):
        qs = PayrollProfile.objects.select_related('person').all()
        person_id = self.request.query_params.get('person_id')
        if person_id:
            qs = qs.filter(person_id=person_id)
        active = self.request.query_params.get('active')
        if active in ('1', 'true', 'True'):
            qs = qs.filter(is_active=True)
        return qs.order_by('person__full_name')

    def perform_create(self, serializer):
        _require_role(self.request.user, [ROLE_HR, ROLE_ADMIN, ROLE_ACCOUNTING])
        obj = serializer.save()
        _audit(self.request, 'payroll_profile.create', 'payroll_profile', obj.id)


class PayrollProfileDetailView(generics.RetrieveUpdateAPIView):
    queryset = PayrollProfile.objects.select_related('person').all()
    serializer_class = PayrollProfileSerializer

    def perform_update(self, serializer):
        _require_role(self.request.user, [ROLE_HR, ROLE_ADMIN, ROLE_ACCOUNTING])
        obj = serializer.save()
        _audit(self.request, 'payroll_profile.update', 'payroll_profile', obj.id)


class PayrollSummaryView(APIView):
    def get(self, request):
        _require_role(request.user, [ROLE_HR, ROLE_ADMIN, ROLE_ACCOUNTING])
        date_from = request.query_params.get('date_from')
        date_to = request.query_params.get('date_to')
        person_id = request.query_params.get('person_id')

        parsed_from = parse_date(date_from) if date_from else None
        parsed_to = parse_date(date_to) if date_to else None
        if not parsed_from or not parsed_to:
            raise ValidationError('date_from ve date_to gerekli.')
        if parsed_to < parsed_from:
            raise ValidationError('date_to, date_from tarihinden once olamaz.')

        records_qs = AbsenceRecord.objects.select_related('person', 'absence_type').filter(
            start_at__date__gte=parsed_from, start_at__date__lte=parsed_to
        )
        if person_id:
            records_qs = records_qs.filter(person_id=person_id)

        profiles = PayrollProfile.objects.select_related('person').all()
        if person_id:
            profiles = profiles.filter(person_id=person_id)
        profile_map = {p.person_id: p for p in profiles}

        grouped = {}
        for record in records_qs:
            grouped.setdefault(record.person_id, []).append(record)

        persons_payload = []
        for pid, items in grouped.items():
            person = items[0].person
            profile = profile_map.get(pid)
            totals = {
                'absence_days': Decimal('0'),
                'absence_hours': Decimal('0'),
                'payroll_deduction': Decimal('0'),
                'premium_deduction': Decimal('0'),
                'records': 0,
            }
            record_payloads = []

            for record in items:
                unit, value, hours, days = _duration_from_record(record)
                rate = None
                premium_rate = None
                if profile:
                    if unit == AbsenceType.DurationUnit.HOURLY:
                        rate = _decimal(profile.hourly_rate)
                        premium_rate = _decimal(profile.premium_hourly_rate)
                    else:
                        rate = _decimal(profile.daily_rate)
                        premium_rate = _decimal(profile.premium_daily_rate)

                payroll_deduction = Decimal('0')
                premium_deduction = Decimal('0')
                if record.absence_type.affects_payroll and not record.absence_type.is_paid and rate is not None:
                    payroll_deduction = (value or Decimal('0')) * rate
                if record.absence_type.affects_premium and premium_rate is not None:
                    premium_deduction = (value or Decimal('0')) * premium_rate

                if days is not None:
                    totals['absence_days'] += days
                if hours is not None:
                    totals['absence_hours'] += hours

                totals['payroll_deduction'] += payroll_deduction
                totals['premium_deduction'] += premium_deduction
                totals['records'] += 1

                record_payloads.append(
                    {
                        'id': str(record.id),
                        'absence_type': record.absence_type.name,
                        'sgk_code': record.absence_type.sgk_code,
                        'start_at': record.start_at,
                        'end_at': record.end_at,
                        'duration_unit': unit,
                        'duration_value': value,
                        'is_paid': record.absence_type.is_paid,
                        'affects_payroll': record.absence_type.affects_payroll,
                        'affects_premium': record.absence_type.affects_premium,
                        'payroll_deduction': payroll_deduction,
                        'premium_deduction': premium_deduction,
                    }
                )

            persons_payload.append(
                {
                    'person': {
                        'id': str(person.id),
                        'full_name': person.full_name,
                        'tc_no': person.tc_no,
                    },
                    'profile': PayrollProfileSerializer(profile).data if profile else None,
                    'totals': totals,
                    'records': record_payloads,
                }
            )

        return Response(
            {
                'date_from': parsed_from.isoformat(),
                'date_to': parsed_to.isoformat(),
                'currency': profiles.first().currency if profiles.exists() else 'TRY',
                'persons': persons_payload,
            }
        )


class SGKReportView(APIView):
    def get(self, request):
        _require_role(request.user, [ROLE_HR, ROLE_ADMIN, ROLE_ACCOUNTING])
        date_from = request.query_params.get('date_from')
        date_to = request.query_params.get('date_to')
        parsed_from = parse_date(date_from) if date_from else None
        parsed_to = parse_date(date_to) if date_to else None
        if not parsed_from or not parsed_to:
            raise ValidationError('date_from ve date_to gerekli.')
        if parsed_to < parsed_from:
            raise ValidationError('date_to, date_from tarihinden once olamaz.')

        records_qs = AbsenceRecord.objects.select_related('person', 'absence_type').filter(
            start_at__date__gte=parsed_from, start_at__date__lte=parsed_to
        )

        grouped = {}
        details = []
        for record in records_qs:
            if not record.absence_type.affects_sgk and not record.absence_type.sgk_code:
                continue
            unit, value, hours, days = _duration_from_record(record)
            code = record.absence_type.sgk_code or 'UNKNOWN'
            key = (code, record.person_id)
            grouped.setdefault(key, {'days': Decimal('0'), 'hours': Decimal('0'), 'records': 0})
            if days is not None:
                grouped[key]['days'] += days
            if hours is not None:
                grouped[key]['hours'] += hours
            grouped[key]['records'] += 1

            details.append(
                {
                    'person_id': str(record.person_id),
                    'person_name': record.person.full_name,
                    'tc_no': record.person.tc_no,
                    'absence_type': record.absence_type.name,
                    'sgk_code': code,
                    'duration_unit': unit,
                    'duration_value': value,
                    'start_at': record.start_at,
                    'end_at': record.end_at,
                }
            )

        summary = []
        for (code, person_id), data in grouped.items():
            person_name = next(
                (item['person_name'] for item in details if item['person_id'] == str(person_id) and item['sgk_code'] == code),
                '',
            )
            summary.append(
                {
                    'sgk_code': code,
                    'person_id': str(person_id),
                    'person_name': person_name,
                    'missing_days': data['days'],
                    'missing_hours': data['hours'],
                    'records': data['records'],
                }
            )

        return Response(
            {
                'date_from': parsed_from.isoformat(),
                'date_to': parsed_to.isoformat(),
                'summary': summary,
                'records': details,
            }
        )
