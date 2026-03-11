import hashlib
import secrets
import uuid
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.db import models
from django.utils import timezone


class Site(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200, unique=True)
    is_active = models.BooleanField(default=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name


class Gate(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    site = models.ForeignKey(Site, on_delete=models.PROTECT, related_name='gates')

    name = models.CharField(max_length=200)
    code = models.SlugField(max_length=50)
    is_active = models.BooleanField(default=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['site', 'code'], name='uniq_gate_code_per_site'),
        ]

    def __str__(self):
        return f'{self.site.name} / {self.name}'


class Device(models.Model):
    """
    Kiosk cihazı.

    device_id: cihazın public kimliği (örn: KIOSK-1). device_key server'da hash'li tutulur.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    gate = models.ForeignKey(Gate, on_delete=models.PROTECT, related_name='devices')

    name = models.CharField(max_length=200)
    device_id = models.CharField(max_length=100, unique=True)
    device_key_hash = models.CharField(max_length=200)
    is_active = models.BooleanField(default=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def set_device_key(self, raw_key: str):
        self.device_key_hash = make_password(raw_key)

    def check_device_key(self, raw_key: str) -> bool:
        return check_password(raw_key, self.device_key_hash)

    def __str__(self):
        return f'{self.device_id} ({self.name})'


def _hash_token(token: str) -> str:
    return hashlib.sha256(f'{settings.SECRET_KEY}:{token}'.encode('utf-8')).hexdigest()


class DeviceSession(models.Model):
    """
    Device token'ı için server-side session.
    Token plaintext sadece yaratıldığı anda client'a döner.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    device = models.ForeignKey(Device, on_delete=models.CASCADE, related_name='sessions')

    token_hash = models.CharField(max_length=64, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_seen_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True, blank=True)

    @classmethod
    def issue_token(cls, device: Device, ttl_days: int = 30):
        raw = secrets.token_urlsafe(32)
        now = timezone.now()
        session = cls.objects.create(
            device=device,
            token_hash=_hash_token(raw),
            last_seen_at=now,
            expires_at=now + timedelta(days=ttl_days),
        )
        return session, raw

    def is_valid(self) -> bool:
        if self.revoked_at is not None:
            return False
        return self.expires_at > timezone.now()

    def __str__(self):
        return f'{self.device.device_id} session ({self.created_at:%Y-%m-%d})'


class Person(models.Model):
    class Kind(models.TextChoices):
        EMPLOYEE = 'employee', 'Employee'
        VISITOR = 'visitor', 'Visitor'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    kind = models.CharField(max_length=20, choices=Kind.choices)
    full_name = models.CharField(max_length=200)

    tc_no = models.CharField(max_length=11, blank=True, default='')
    phone = models.CharField(max_length=30, blank=True, default='')

    is_inside = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=['kind', 'full_name']),
            models.Index(fields=['tc_no']),
            models.Index(fields=['phone']),
            models.Index(fields=['is_inside']),
        ]

    def __str__(self):
        return f'{self.full_name} ({self.kind})'


class Badge(models.Model):
    class Kind(models.TextChoices):
        CARD = 'card', 'Card'
        QR = 'qr', 'QR'
        BARCODE = 'barcode', 'Barcode'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    person = models.ForeignKey(Person, on_delete=models.CASCADE, related_name='badges')
    kind = models.CharField(max_length=20, choices=Kind.choices, default=Kind.CARD)
    code = models.CharField(max_length=200, unique=True)
    is_active = models.BooleanField(default=True)

    issued_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.code


class AbsenceType(models.Model):
    class DurationUnit(models.TextChoices):
        FULL_DAY = 'FULL_DAY', 'Full Day'
        HALF_DAY = 'HALF_DAY', 'Half Day'
        HOURLY = 'HOURLY', 'Hourly'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200, unique=True)
    code = models.SlugField(max_length=50, unique=True)
    description = models.TextField(blank=True, default='')

    is_active = models.BooleanField(default=True)
    is_paid = models.BooleanField(default=False)
    affects_payroll = models.BooleanField(default=False)
    affects_sgk = models.BooleanField(default=False)
    affects_premium = models.BooleanField(default=False)
    sgk_code = models.CharField(max_length=20, blank=True, default='')
    requires_document = models.BooleanField(default=False)
    is_excused_default = models.BooleanField(default=False)
    default_unit = models.CharField(
        max_length=20,
        choices=DurationUnit.choices,
        default=DurationUnit.FULL_DAY,
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class AbsenceRecord(models.Model):
    class Status(models.TextChoices):
        DRAFT = 'DRAFT', 'Draft'
        SUBMITTED = 'SUBMITTED', 'Submitted'
        APPROVED = 'APPROVED', 'Approved'
        REJECTED = 'REJECTED', 'Rejected'
        CANCELLED = 'CANCELLED', 'Cancelled'

    class Source(models.TextChoices):
        MANUAL = 'MANUAL', 'Manual'
        IMPORT = 'IMPORT', 'Import'
        PDKS = 'PDKS', 'PDKS'
        INTEGRATION = 'INTEGRATION', 'Integration'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    person = models.ForeignKey(Person, on_delete=models.PROTECT, related_name='absence_records')
    absence_type = models.ForeignKey(AbsenceType, on_delete=models.PROTECT, related_name='records')

    status = models.CharField(max_length=20, choices=Status.choices, default=Status.SUBMITTED)
    start_at = models.DateTimeField()
    end_at = models.DateTimeField(null=True, blank=True)
    duration_unit = models.CharField(
        max_length=20,
        choices=AbsenceType.DurationUnit.choices,
        default=AbsenceType.DurationUnit.FULL_DAY,
    )
    duration_value = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    is_excused = models.BooleanField(default=False)
    note = models.TextField(blank=True, default='')
    source = models.CharField(max_length=20, choices=Source.choices, default=Source.MANUAL)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='absence_created',
    )
    manager_approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='absence_manager_approved',
    )
    manager_approved_at = models.DateTimeField(null=True, blank=True)
    hr_approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='absence_hr_approved',
    )
    hr_approved_at = models.DateTimeField(null=True, blank=True)
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='absence_approved',
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    rejected_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='absence_rejected',
    )
    rejected_at = models.DateTimeField(null=True, blank=True)
    cancelled_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='absence_cancelled',
    )
    cancelled_at = models.DateTimeField(null=True, blank=True)
    approved_note = models.TextField(blank=True, default='')

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=['person', 'start_at']),
            models.Index(fields=['status', 'start_at']),
        ]
        ordering = ['-start_at']

    def __str__(self):
        return f'{self.person.full_name} - {self.absence_type.name} ({self.start_at:%Y-%m-%d})'


class Role(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.SlugField(max_length=50, unique=True)
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True, default='')
    is_active = models.BooleanField(default=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class UserRole(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='roles')
    role = models.ForeignKey(Role, on_delete=models.CASCADE, related_name='users')
    assigned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='roles_assigned',
    )
    assigned_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['user', 'role'], name='uniq_user_role'),
        ]

    def __str__(self):
        return f'{self.user} -> {self.role.code}'


class WorkShift(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200)
    code = models.SlugField(max_length=50, unique=True)
    description = models.TextField(blank=True, default='')

    start_time = models.TimeField()
    end_time = models.TimeField()
    late_tolerance_minutes = models.PositiveIntegerField(default=0)
    early_leave_tolerance_minutes = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class ShiftAssignment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    person = models.ForeignKey(Person, on_delete=models.PROTECT, related_name='shift_assignments')
    shift = models.ForeignKey(WorkShift, on_delete=models.PROTECT, related_name='assignments')
    effective_from = models.DateField()
    effective_to = models.DateField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=['person', 'effective_from']),
            models.Index(fields=['shift', 'effective_from']),
        ]
        ordering = ['-effective_from']

    def __str__(self):
        return f'{self.person.full_name} -> {self.shift.code}'


class PayrollProfile(models.Model):
    class SalaryType(models.TextChoices):
        HOURLY = 'HOURLY', 'Hourly'
        DAILY = 'DAILY', 'Daily'
        MONTHLY = 'MONTHLY', 'Monthly'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    person = models.OneToOneField(Person, on_delete=models.CASCADE, related_name='payroll_profile')

    salary_type = models.CharField(max_length=20, choices=SalaryType.choices, default=SalaryType.DAILY)
    hourly_rate = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    daily_rate = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    monthly_salary = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    premium_hourly_rate = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    premium_daily_rate = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    currency = models.CharField(max_length=10, default='TRY')
    is_active = models.BooleanField(default=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['person__full_name']

    def __str__(self):
        return f'{self.person.full_name} payroll'


class AccessEvent(models.Model):
    class Direction(models.TextChoices):
        IN = 'IN', 'IN'
        OUT = 'OUT', 'OUT'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    client_event_uuid = models.UUIDField(unique=True)

    site = models.ForeignKey(Site, on_delete=models.PROTECT, related_name='events')
    gate = models.ForeignKey(Gate, on_delete=models.PROTECT, related_name='events')
    device = models.ForeignKey(Device, on_delete=models.PROTECT, related_name='events')

    person = models.ForeignKey(Person, on_delete=models.PROTECT, related_name='events')
    badge = models.ForeignKey(Badge, on_delete=models.SET_NULL, null=True, blank=True, related_name='events')

    direction = models.CharField(max_length=3, choices=Direction.choices)
    created_at = models.DateTimeField(auto_now_add=True)

    note = models.TextField(blank=True, default='')
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=['created_at']),
            models.Index(fields=['direction', 'created_at']),
            models.Index(fields=['person', 'created_at']),
        ]

    def __str__(self):
        return f'{self.person} {self.direction} ({self.created_at:%Y-%m-%d %H:%M})'


class SecurityLog(models.Model):
    """
    Frontend ile uyumlu guvenlik loglari. Supabase security_logs tablosu ile paralel tutulur.
    """

    event_type = models.CharField(max_length=50, blank=True, default='')
    type = models.CharField(max_length=50, blank=True, default='')
    sub_category = models.CharField(max_length=100, blank=True, default='')
    shift = models.CharField(max_length=100, blank=True, default='')
    plate = models.CharField(max_length=50, blank=True, default='')
    driver = models.CharField(max_length=200, blank=True, default='')
    name = models.CharField(max_length=200, blank=True, default='')
    host = models.CharField(max_length=200, blank=True, default='')
    note = models.TextField(blank=True, default='')
    location = models.CharField(max_length=200, blank=True, default='')
    entry_location = models.CharField(max_length=200, blank=True, default='')
    exit_location = models.CharField(max_length=200, blank=True, default='')
    seal_number = models.CharField(max_length=100, blank=True, default='')
    seal_number_entry = models.CharField(max_length=100, blank=True, default='')
    seal_number_exit = models.CharField(max_length=100, blank=True, default='')
    tc_no = models.CharField(max_length=11, blank=True, default='')
    phone = models.CharField(max_length=30, blank=True, default='')
    user_email = models.CharField(max_length=200, blank=True, default='')

    created_at = models.DateTimeField(db_index=True, unique=True)
    exit_at = models.DateTimeField(null=True, blank=True, db_index=True)

    class Meta:
        indexes = [
            models.Index(fields=['plate']),
            models.Index(fields=['name']),
        ]

    def __str__(self):
        return f'{self.plate or self.name} ({self.created_at:%Y-%m-%d %H:%M})'


class AuditLog(models.Model):
    """
    Minimal audit log iskeleti. İleride view/service katmanından doldurulur.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)

    actor_user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='audit_logs'
    )
    actor_device = models.ForeignKey(Device, on_delete=models.SET_NULL, null=True, blank=True, related_name='audit_logs')

    action = models.CharField(max_length=100)
    object_type = models.CharField(max_length=100, blank=True, default='')
    object_id = models.CharField(max_length=100, blank=True, default='')
    message = models.TextField(blank=True, default='')
    ip_address = models.GenericIPAddressField(null=True, blank=True)

    def __str__(self):
        return f'{self.action} ({self.created_at:%Y-%m-%d %H:%M})'
