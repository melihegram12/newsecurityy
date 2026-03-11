import uuid

from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('core', '0002_securitylog'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='AbsenceType',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('name', models.CharField(max_length=200, unique=True)),
                ('code', models.SlugField(max_length=50, unique=True)),
                ('description', models.TextField(blank=True, default='')),
                ('is_active', models.BooleanField(default=True)),
                ('is_paid', models.BooleanField(default=False)),
                ('affects_payroll', models.BooleanField(default=False)),
                ('affects_sgk', models.BooleanField(default=False)),
                ('affects_premium', models.BooleanField(default=False)),
                ('sgk_code', models.CharField(blank=True, default='', max_length=20)),
                ('requires_document', models.BooleanField(default=False)),
                ('is_excused_default', models.BooleanField(default=False)),
                (
                    'default_unit',
                    models.CharField(
                        choices=[('FULL_DAY', 'Full Day'), ('HALF_DAY', 'Half Day'), ('HOURLY', 'Hourly')],
                        default='FULL_DAY',
                        max_length=20,
                    ),
                ),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'ordering': ['name'],
            },
        ),
        migrations.CreateModel(
            name='AbsenceRecord',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                (
                    'status',
                    models.CharField(
                        choices=[
                            ('DRAFT', 'Draft'),
                            ('SUBMITTED', 'Submitted'),
                            ('APPROVED', 'Approved'),
                            ('REJECTED', 'Rejected'),
                            ('CANCELLED', 'Cancelled'),
                        ],
                        default='SUBMITTED',
                        max_length=20,
                    ),
                ),
                ('start_at', models.DateTimeField()),
                ('end_at', models.DateTimeField(blank=True, null=True)),
                (
                    'duration_unit',
                    models.CharField(
                        choices=[('FULL_DAY', 'Full Day'), ('HALF_DAY', 'Half Day'), ('HOURLY', 'Hourly')],
                        default='FULL_DAY',
                        max_length=20,
                    ),
                ),
                ('duration_value', models.DecimalField(blank=True, decimal_places=2, max_digits=6, null=True)),
                ('is_excused', models.BooleanField(default=False)),
                ('note', models.TextField(blank=True, default='')),
                (
                    'source',
                    models.CharField(
                        choices=[
                            ('MANUAL', 'Manual'),
                            ('IMPORT', 'Import'),
                            ('PDKS', 'PDKS'),
                            ('INTEGRATION', 'Integration'),
                        ],
                        default='MANUAL',
                        max_length=20,
                    ),
                ),
                ('approved_at', models.DateTimeField(blank=True, null=True)),
                ('approved_note', models.TextField(blank=True, default='')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                (
                    'absence_type',
                    models.ForeignKey(on_delete=models.deletion.PROTECT, related_name='records', to='core.absencetype'),
                ),
                (
                    'approved_by',
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=models.deletion.SET_NULL,
                        related_name='absence_approved',
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    'created_by',
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=models.deletion.SET_NULL,
                        related_name='absence_created',
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    'person',
                    models.ForeignKey(on_delete=models.deletion.PROTECT, related_name='absence_records', to='core.person'),
                ),
            ],
            options={
                'ordering': ['-start_at'],
                'indexes': [
                    models.Index(fields=['person', 'start_at'], name='core_absenc_person_start_idx'),
                    models.Index(fields=['status', 'start_at'], name='core_absenc_status_start_idx'),
                ],
            },
        ),
    ]
