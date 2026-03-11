import secrets

from django.core.management.base import BaseCommand

from core.models import Device, Gate, Site


class Command(BaseCommand):
    help = 'Create (or update) a Site/Gate/Device and print a device_key for kiosk auth.'

    def add_arguments(self, parser):
        parser.add_argument('--site', required=True, help='Site name (e.g. Factory A)')
        parser.add_argument('--gate', required=True, help='Gate name (e.g. Main Gate)')
        parser.add_argument('--gate-code', required=True, help='Gate code (slug, e.g. main-gate)')
        parser.add_argument('--device-id', required=True, help='Public device id (e.g. KIOSK-1)')
        parser.add_argument('--device-name', required=True, help='Device display name')
        parser.add_argument('--device-key', required=False, help='Device secret; if omitted a random key is generated')

    def handle(self, *args, **options):
        site, _ = Site.objects.get_or_create(name=options['site'])
        gate, _ = Gate.objects.get_or_create(site=site, code=options['gate_code'], defaults={'name': options['gate']})
        if gate.name != options['gate']:
            gate.name = options['gate']
            gate.save(update_fields=['name', 'updated_at'])

        device_key = options.get('device_key') or secrets.token_urlsafe(32)
        device, created = Device.objects.get_or_create(
            device_id=options['device_id'],
            defaults={'name': options['device_name'], 'gate': gate, 'device_key_hash': ''},
        )
        if not created:
            device.name = options['device_name']
            device.gate = gate

        device.set_device_key(device_key)
        device.is_active = True
        device.save()

        self.stdout.write(self.style.SUCCESS('Device ready'))
        self.stdout.write(f"site_id={site.id}")
        self.stdout.write(f"gate_id={gate.id}")
        self.stdout.write(f"device_id={device.device_id}")
        self.stdout.write(f"device_db_id={device.id}")
        self.stdout.write(f"device_key={device_key}")
