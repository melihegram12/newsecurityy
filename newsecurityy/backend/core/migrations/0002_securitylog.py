from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('core', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='SecurityLog',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('event_type', models.CharField(blank=True, default='', max_length=50)),
                ('type', models.CharField(blank=True, default='', max_length=50)),
                ('sub_category', models.CharField(blank=True, default='', max_length=100)),
                ('shift', models.CharField(blank=True, default='', max_length=100)),
                ('plate', models.CharField(blank=True, default='', max_length=50)),
                ('driver', models.CharField(blank=True, default='', max_length=200)),
                ('name', models.CharField(blank=True, default='', max_length=200)),
                ('host', models.CharField(blank=True, default='', max_length=200)),
                ('note', models.TextField(blank=True, default='')),
                ('location', models.CharField(blank=True, default='', max_length=200)),
                ('seal_number', models.CharField(blank=True, default='', max_length=100)),
                ('seal_number_entry', models.CharField(blank=True, default='', max_length=100)),
                ('seal_number_exit', models.CharField(blank=True, default='', max_length=100)),
                ('tc_no', models.CharField(blank=True, default='', max_length=11)),
                ('phone', models.CharField(blank=True, default='', max_length=30)),
                ('user_email', models.CharField(blank=True, default='', max_length=200)),
                ('created_at', models.DateTimeField(db_index=True, unique=True)),
                ('exit_at', models.DateTimeField(blank=True, db_index=True, null=True)),
            ],
            options={
                'indexes': [
                    models.Index(fields=['plate'], name='core_securi_plate_7b33f5_idx'),
                    models.Index(fields=['name'], name='core_securi_name_73b9c7_idx'),
                ],
            },
        ),
    ]
