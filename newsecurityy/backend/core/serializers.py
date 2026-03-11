from decimal import Decimal

from rest_framework import serializers

from .models import (
    AbsenceRecord,
    AbsenceType,
    AccessEvent,
    AuditLog,
    Person,
    PayrollProfile,
    Role,
    SecurityLog,
    ShiftAssignment,
    UserRole,
    WorkShift,
)


class DeviceAuthRequestSerializer(serializers.Serializer):
    device_id = serializers.CharField()
    device_key = serializers.CharField(trim_whitespace=False)


class DeviceAuthResponseSerializer(serializers.Serializer):
    token = serializers.CharField()
    expires_at = serializers.DateTimeField()
    device = serializers.DictField()


class PersonInputSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=Person.Kind.choices)
    full_name = serializers.CharField()
    tc_no = serializers.CharField(required=False, allow_blank=True, max_length=11)
    phone = serializers.CharField(required=False, allow_blank=True, max_length=30)


class CheckRequestSerializer(serializers.Serializer):
    client_event_uuid = serializers.UUIDField()
    direction = serializers.ChoiceField(choices=AccessEvent.Direction.choices)

    badge_code = serializers.CharField(required=False, allow_blank=True)
    person_id = serializers.UUIDField(required=False)
    person = PersonInputSerializer(required=False)

    note = serializers.CharField(required=False, allow_blank=True)
    metadata = serializers.DictField(required=False)

    def validate(self, attrs):
        badge_code = (attrs.get('badge_code') or '').strip()
        person_id = attrs.get('person_id')
        person = attrs.get('person')

        if not badge_code and not person_id and not person:
            raise serializers.ValidationError(
                'Kişiyi tanımlamak için badge_code veya person_id veya person alanı gerekli.'
            )

        return attrs


class AccessEventSerializer(serializers.ModelSerializer):
    person = serializers.SerializerMethodField()
    badge = serializers.SerializerMethodField()

    class Meta:
        model = AccessEvent
        fields = (
            'id',
            'client_event_uuid',
            'created_at',
            'direction',
            'site',
            'gate',
            'device',
            'person',
            'badge',
            'note',
            'metadata',
        )

    def get_person(self, obj):
        return {
            'id': str(obj.person_id),
            'kind': obj.person.kind,
            'full_name': obj.person.full_name,
            'is_inside': obj.person.is_inside,
        }

    def get_badge(self, obj):
        if not obj.badge_id:
            return None
        return {
            'id': str(obj.badge_id),
            'code': obj.badge.code,
            'kind': obj.badge.kind,
        }


class SecurityLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = SecurityLog
        fields = (
            'id',
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
        )


class LogSyncSerializer(serializers.Serializer):
    action = serializers.ChoiceField(choices=('INSERT', 'UPDATE', 'DELETE', 'EXIT'))
    data = serializers.DictField(required=False, allow_null=True)
    local_id = serializers.CharField(required=False, allow_blank=True)


class AbsenceTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = AbsenceType
        fields = (
            'id',
            'name',
            'code',
            'description',
            'is_active',
            'is_paid',
            'affects_payroll',
            'affects_sgk',
            'affects_premium',
            'sgk_code',
            'requires_document',
            'is_excused_default',
            'default_unit',
            'created_at',
            'updated_at',
        )


class AbsenceRecordSerializer(serializers.ModelSerializer):
    person_name = serializers.CharField(source='person.full_name', read_only=True)
    absence_type_name = serializers.CharField(source='absence_type.name', read_only=True)

    class Meta:
        model = AbsenceRecord
        fields = (
            'id',
            'person',
            'person_name',
            'absence_type',
            'absence_type_name',
            'status',
            'start_at',
            'end_at',
            'duration_unit',
            'duration_value',
            'is_excused',
            'note',
            'source',
            'created_by',
            'manager_approved_by',
            'manager_approved_at',
            'hr_approved_by',
            'hr_approved_at',
            'approved_by',
            'approved_at',
            'rejected_by',
            'rejected_at',
            'cancelled_by',
            'cancelled_at',
            'approved_note',
            'created_at',
            'updated_at',
        )
        read_only_fields = (
            'created_by',
            'manager_approved_by',
            'manager_approved_at',
            'hr_approved_by',
            'hr_approved_at',
            'approved_by',
            'approved_at',
            'rejected_by',
            'rejected_at',
            'cancelled_by',
            'cancelled_at',
        )

    def validate(self, attrs):
        start_at = attrs.get('start_at')
        end_at = attrs.get('end_at')
        if start_at and end_at and end_at < start_at:
            raise serializers.ValidationError('end_at start_at tarihinden once olamaz.')
        return attrs

    def _default_duration(self, unit, start_at, end_at):
        if unit == AbsenceType.DurationUnit.HALF_DAY:
            return Decimal('0.5')
        if unit == AbsenceType.DurationUnit.FULL_DAY:
            return Decimal('1')
        if unit == AbsenceType.DurationUnit.HOURLY and start_at and end_at:
            diff_seconds = (end_at - start_at).total_seconds()
            hours = max(0, diff_seconds / 3600)
            return Decimal(f'{hours:.2f}')
        return None

    def create(self, validated_data):
        absence_type = validated_data['absence_type']
        if not validated_data.get('duration_unit'):
            validated_data['duration_unit'] = absence_type.default_unit

        if validated_data.get('duration_value') is None:
            duration = self._default_duration(
                validated_data.get('duration_unit'),
                validated_data.get('start_at'),
                validated_data.get('end_at'),
            )
            if duration is None:
                raise serializers.ValidationError('duration_value veya uygun end_at gerekli.')
            validated_data['duration_value'] = duration

        if 'is_excused' not in validated_data:
            validated_data['is_excused'] = absence_type.is_excused_default

        return super().create(validated_data)


class RoleSerializer(serializers.ModelSerializer):
    class Meta:
        model = Role
        fields = ('id', 'code', 'name', 'description', 'is_active', 'created_at', 'updated_at')


class UserRoleSerializer(serializers.ModelSerializer):
    role = RoleSerializer(read_only=True)

    class Meta:
        model = UserRole
        fields = ('id', 'role', 'assigned_by', 'assigned_at')


class AuditLogSerializer(serializers.ModelSerializer):
    actor_user = serializers.SerializerMethodField()
    actor_device = serializers.SerializerMethodField()

    class Meta:
        model = AuditLog
        fields = (
            'id',
            'created_at',
            'action',
            'object_type',
            'object_id',
            'message',
            'ip_address',
            'actor_user',
            'actor_device',
        )

    def get_actor_user(self, obj):
        if not obj.actor_user_id:
            return None
        return {
            'id': obj.actor_user_id,
            'username': getattr(obj.actor_user, 'username', ''),
            'email': getattr(obj.actor_user, 'email', ''),
        }

    def get_actor_device(self, obj):
        if not obj.actor_device_id:
            return None
        return {
            'id': str(obj.actor_device_id),
            'device_id': obj.actor_device.device_id,
            'name': obj.actor_device.name,
        }


class WorkShiftSerializer(serializers.ModelSerializer):
    class Meta:
        model = WorkShift
        fields = (
            'id',
            'name',
            'code',
            'description',
            'start_time',
            'end_time',
            'late_tolerance_minutes',
            'early_leave_tolerance_minutes',
            'is_active',
            'created_at',
            'updated_at',
        )


class ShiftAssignmentSerializer(serializers.ModelSerializer):
    person_name = serializers.CharField(source='person.full_name', read_only=True)
    shift_name = serializers.CharField(source='shift.name', read_only=True)
    shift_code = serializers.CharField(source='shift.code', read_only=True)

    class Meta:
        model = ShiftAssignment
        fields = (
            'id',
            'person',
            'person_name',
            'shift',
            'shift_name',
            'shift_code',
            'effective_from',
            'effective_to',
            'is_active',
            'created_at',
            'updated_at',
        )

    def validate(self, attrs):
        start = attrs.get('effective_from')
        end = attrs.get('effective_to')
        if start and end and end < start:
            raise serializers.ValidationError('effective_to effective_from tarihinden once olamaz.')
        return attrs


class PayrollProfileSerializer(serializers.ModelSerializer):
    person_name = serializers.CharField(source='person.full_name', read_only=True)

    class Meta:
        model = PayrollProfile
        fields = (
            'id',
            'person',
            'person_name',
            'salary_type',
            'hourly_rate',
            'daily_rate',
            'monthly_salary',
            'premium_hourly_rate',
            'premium_daily_rate',
            'currency',
            'is_active',
            'created_at',
            'updated_at',
        )
