from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0007_rename_core_absenc_person_start_idx_core_absenc_person__3565ba_idx_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='securitylog',
            name='entry_location',
            field=models.CharField(blank=True, default='', max_length=200),
        ),
        migrations.AddField(
            model_name='securitylog',
            name='exit_location',
            field=models.CharField(blank=True, default='', max_length=200),
        ),
    ]
