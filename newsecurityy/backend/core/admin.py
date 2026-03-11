from django.contrib import admin

from .models import (
    AbsenceRecord,
    AbsenceType,
    AccessEvent,
    AuditLog,
    Badge,
    Device,
    DeviceSession,
    Gate,
    Person,
    PayrollProfile,
    Role,
    SecurityLog,
    ShiftAssignment,
    Site,
    UserRole,
    WorkShift,
)


@admin.register(Site)
class SiteAdmin(admin.ModelAdmin):
    list_display = ('name', 'is_active', 'created_at')
    search_fields = ('name',)


@admin.register(Gate)
class GateAdmin(admin.ModelAdmin):
    list_display = ('name', 'site', 'code', 'is_active')
    list_filter = ('site', 'is_active')
    search_fields = ('name', 'code')


@admin.register(Device)
class DeviceAdmin(admin.ModelAdmin):
    list_display = ('device_id', 'name', 'gate', 'is_active', 'created_at')
    list_filter = ('is_active', 'gate__site')
    search_fields = ('device_id', 'name')


@admin.register(DeviceSession)
class DeviceSessionAdmin(admin.ModelAdmin):
    list_display = ('device', 'created_at', 'expires_at', 'revoked_at', 'last_seen_at')
    list_filter = ('device',)


@admin.register(Person)
class PersonAdmin(admin.ModelAdmin):
    list_display = ('full_name', 'kind', 'tc_no', 'phone', 'is_inside', 'is_active')
    list_filter = ('kind', 'is_inside', 'is_active')
    search_fields = ('full_name', 'tc_no', 'phone')


@admin.register(Badge)
class BadgeAdmin(admin.ModelAdmin):
    list_display = ('code', 'kind', 'person', 'is_active', 'issued_at')
    list_filter = ('kind', 'is_active')
    search_fields = ('code', 'person__full_name')


@admin.register(AccessEvent)
class AccessEventAdmin(admin.ModelAdmin):
    list_display = ('created_at', 'direction', 'person', 'badge', 'site', 'gate', 'device')
    list_filter = ('direction', 'site', 'gate', 'device')
    search_fields = ('person__full_name', 'badge__code', 'device__device_id')


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ('created_at', 'action', 'actor_user', 'actor_device', 'object_type', 'object_id')
    list_filter = ('action',)


@admin.register(SecurityLog)
class SecurityLogAdmin(admin.ModelAdmin):
    list_display = ('created_at', 'type', 'sub_category', 'plate', 'name', 'exit_at')
    list_filter = ('type', 'sub_category')
    search_fields = ('plate', 'name', 'driver', 'host', 'tc_no', 'phone')


@admin.register(AbsenceType)
class AbsenceTypeAdmin(admin.ModelAdmin):
    list_display = ('name', 'code', 'is_active', 'is_paid', 'affects_payroll', 'affects_sgk', 'default_unit')
    list_filter = ('is_active', 'is_paid', 'affects_payroll', 'affects_sgk', 'default_unit')
    search_fields = ('name', 'code')


@admin.register(AbsenceRecord)
class AbsenceRecordAdmin(admin.ModelAdmin):
    list_display = (
        'person',
        'absence_type',
        'status',
        'start_at',
        'end_at',
        'duration_value',
        'duration_unit',
        'manager_approved_at',
        'hr_approved_at',
    )
    list_filter = ('status', 'absence_type', 'duration_unit')
    search_fields = ('person__full_name', 'absence_type__name')


@admin.register(Role)
class RoleAdmin(admin.ModelAdmin):
    list_display = ('code', 'name', 'is_active', 'created_at')
    list_filter = ('is_active',)
    search_fields = ('code', 'name')


@admin.register(UserRole)
class UserRoleAdmin(admin.ModelAdmin):
    list_display = ('user', 'role', 'assigned_by', 'assigned_at')
    list_filter = ('role',)
    search_fields = ('user__email', 'user__username', 'role__code')


@admin.register(WorkShift)
class WorkShiftAdmin(admin.ModelAdmin):
    list_display = ('name', 'code', 'start_time', 'end_time', 'late_tolerance_minutes', 'early_leave_tolerance_minutes', 'is_active')
    list_filter = ('is_active',)
    search_fields = ('name', 'code')


@admin.register(ShiftAssignment)
class ShiftAssignmentAdmin(admin.ModelAdmin):
    list_display = ('person', 'shift', 'effective_from', 'effective_to', 'is_active')
    list_filter = ('shift', 'is_active')
    search_fields = ('person__full_name', 'shift__name', 'shift__code')


@admin.register(PayrollProfile)
class PayrollProfileAdmin(admin.ModelAdmin):
    list_display = ('person', 'salary_type', 'hourly_rate', 'daily_rate', 'monthly_salary', 'currency', 'is_active')
    list_filter = ('salary_type', 'is_active', 'currency')
    search_fields = ('person__full_name', 'person__tc_no')
