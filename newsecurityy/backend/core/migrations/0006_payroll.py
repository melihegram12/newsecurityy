import uuid

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ('core', '0005_shifts'),
    ]

    operations = [
        migrations.CreateModel(
            name='PayrollProfile',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                (
                    'salary_type',
                    models.CharField(
                        choices=[('HOURLY', 'Hourly'), ('DAILY', 'Daily'), ('MONTHLY', 'Monthly')],
                        default='DAILY',
                        max_length=20,
                    ),
                ),
                ('hourly_rate', models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True)),
                ('daily_rate', models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True)),
                ('monthly_salary', models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True)),
                ('premium_hourly_rate', models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True)),
                ('premium_daily_rate', models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True)),
                ('currency', models.CharField(default='TRY', max_length=10)),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                (
                    'person',
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='payroll_profile',
                        to='core.person',
                    ),
                ),
            ],
            options={
                'ordering': ['person__full_name'],
            },
        ),
    ]
