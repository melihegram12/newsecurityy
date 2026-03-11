from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='Site',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('name', models.CharField(max_length=200, unique=True)),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
        ),
        migrations.CreateModel(
            name='Gate',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('name', models.CharField(max_length=200)),
                ('code', models.SlugField(max_length=50)),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                (
                    'site',
                    models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='gates', to='core.site'),
                ),
            ],
            options={
                'constraints': [
                    models.UniqueConstraint(fields=('site', 'code'), name='uniq_gate_code_per_site'),
                ],
            },
        ),
        migrations.CreateModel(
            name='Device',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('name', models.CharField(max_length=200)),
                ('device_id', models.CharField(max_length=100, unique=True)),
                ('device_key_hash', models.CharField(max_length=200)),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                (
                    'gate',
                    models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='devices', to='core.gate'),
                ),
            ],
        ),
        migrations.CreateModel(
            name='Person',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('kind', models.CharField(choices=[('employee', 'Employee'), ('visitor', 'Visitor')], max_length=20)),
                ('full_name', models.CharField(max_length=200)),
                ('tc_no', models.CharField(blank=True, default='', max_length=11)),
                ('phone', models.CharField(blank=True, default='', max_length=30)),
                ('is_inside', models.BooleanField(default=False)),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'indexes': [
                    models.Index(fields=['kind', 'full_name'], name='core_person_kind_87ee6e_idx'),
                    models.Index(fields=['tc_no'], name='core_person_tc_no_1ff2a8_idx'),
                    models.Index(fields=['phone'], name='core_person_phone_812b4e_idx'),
                    models.Index(fields=['is_inside'], name='core_person_is_ins_33c4c9_idx'),
                ],
            },
        ),
        migrations.CreateModel(
            name='DeviceSession',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('token_hash', models.CharField(max_length=64, unique=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('last_seen_at', models.DateTimeField(blank=True, null=True)),
                ('expires_at', models.DateTimeField()),
                ('revoked_at', models.DateTimeField(blank=True, null=True)),
                (
                    'device',
                    models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='sessions', to='core.device'),
                ),
            ],
        ),
        migrations.CreateModel(
            name='Badge',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                (
                    'kind',
                    models.CharField(
                        choices=[('card', 'Card'), ('qr', 'QR'), ('barcode', 'Barcode')],
                        default='card',
                        max_length=20,
                    ),
                ),
                ('code', models.CharField(max_length=200, unique=True)),
                ('is_active', models.BooleanField(default=True)),
                ('issued_at', models.DateTimeField(auto_now_add=True)),
                (
                    'person',
                    models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='badges', to='core.person'),
                ),
            ],
        ),
        migrations.CreateModel(
            name='AccessEvent',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('client_event_uuid', models.UUIDField(unique=True)),
                ('direction', models.CharField(choices=[('IN', 'IN'), ('OUT', 'OUT')], max_length=3)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('note', models.TextField(blank=True, default='')),
                ('metadata', models.JSONField(blank=True, default=dict)),
                (
                    'badge',
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name='events',
                        to='core.badge',
                    ),
                ),
                (
                    'device',
                    models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='events', to='core.device'),
                ),
                (
                    'gate',
                    models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='events', to='core.gate'),
                ),
                (
                    'person',
                    models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='events', to='core.person'),
                ),
                (
                    'site',
                    models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='events', to='core.site'),
                ),
            ],
            options={
                'indexes': [
                    models.Index(fields=['created_at'], name='core_accesse_created_fa4b9f_idx'),
                    models.Index(fields=['direction', 'created_at'], name='core_accesse_directi_4d4b9b_idx'),
                    models.Index(fields=['person', 'created_at'], name='core_accesse_person_i_4d1cd4_idx'),
                ],
            },
        ),
        migrations.CreateModel(
            name='AuditLog',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('action', models.CharField(max_length=100)),
                ('object_type', models.CharField(blank=True, default='', max_length=100)),
                ('object_id', models.CharField(blank=True, default='', max_length=100)),
                ('message', models.TextField(blank=True, default='')),
                ('ip_address', models.GenericIPAddressField(blank=True, null=True)),
                (
                    'actor_device',
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name='audit_logs',
                        to='core.device',
                    ),
                ),
                (
                    'actor_user',
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name='audit_logs',
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
        ),
    ]

