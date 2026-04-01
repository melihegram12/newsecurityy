from django.db import migrations


def seed_presets(apps, schema_editor):
    HostPreset = apps.get_model('core', 'HostPreset')
    VehiclePreset = apps.get_model('core', 'VehiclePreset')

    host_presets = [
        (1, 'Y\u00f6netim'),
        (2, '\u0130nsan Kaynaklar\u0131'),
        (3, 'Muhasebe'),
        (4, 'Depo / Lojistik'),
        (5, '\u00dcretim / Fabrika'),
        (6, 'Teknik Servis'),
        (7, '\u015eirket'),
        (8, 'Personel Servisi'),
    ]
    for sort_order, name in host_presets:
        HostPreset.objects.update_or_create(
            name=name,
            defaults={
                'sort_order': sort_order,
                'is_active': True,
            },
        )

    vehicle_presets = [
        ('34 GMP 988', 'G\u00d6KSEL ONU\u015e', 'management', 'owner', 1),
        ('34 GRZ 326', 'G\u00d6KHAN B\u0130L\u0130R', 'management', 'owner', 2),
        ('34 HDD 055', 'CAFER \u00d6ZTOP', 'management', 'owner', 3),
        ('34 GHK 292', '\u015e\u0130RKET ARACI', 'company', 'other', 1),
        ('34 MPP 153', '\u015e\u0130RKET ARACI', 'company', 'other', 2),
    ]
    for plate, label, category, default_driver_type, sort_order in vehicle_presets:
        VehiclePreset.objects.update_or_create(
            plate=plate,
            defaults={
                'label': label,
                'category': category,
                'default_driver_type': default_driver_type,
                'sort_order': sort_order,
                'is_active': True,
            },
        )


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0009_hostpreset_vehiclepreset'),
    ]

    operations = [
        migrations.RunPython(seed_presets, migrations.RunPython.noop),
    ]
