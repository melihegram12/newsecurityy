import uuid

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('core', '0004_roles_and_absence_approvals'),
    ]

    operations = [
        migrations.CreateModel(
            name='WorkShift',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('name', models.CharField(max_length=200)),
                ('code', models.SlugField(max_length=50, unique=True)),
                ('description', models.TextField(blank=True, default='')),
                ('start_time', models.TimeField()),
                ('end_time', models.TimeField()),
                ('late_tolerance_minutes', models.PositiveIntegerField(default=0)),
                ('early_leave_tolerance_minutes', models.PositiveIntegerField(default=0)),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'ordering': ['name'],
            },
        ),
        migrations.CreateModel(
            name='ShiftAssignment',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('effective_from', models.DateField()),
                ('effective_to', models.DateField(blank=True, null=True)),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                (
                    'person',
                    models.ForeignKey(
                        on_delete=models.deletion.PROTECT, related_name='shift_assignments', to='core.person'
                    ),
                ),
                (
                    'shift',
                    models.ForeignKey(
                        on_delete=models.deletion.PROTECT, related_name='assignments', to='core.workshift'
                    ),
                ),
            ],
            options={
                'ordering': ['-effective_from'],
                'indexes': [
                    models.Index(fields=['person', 'effective_from'], name='core_shift_person_eff_idx'),
                    models.Index(fields=['shift', 'effective_from'], name='core_shift_shift_eff_idx'),
                ],
            },
        ),
    ]
