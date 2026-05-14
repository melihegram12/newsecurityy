import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle,
  ClipboardList,
  Database,
  Download,
  FileSpreadsheet,
  Filter,
  HardDrive,
  KeyRound,
  RefreshCw,
  Server,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { Badge, Button, Card, FormField, Input, Select, TableHeadCell } from '../../components/ui';
import { cx } from '../../lib/utils';

const SECTION_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'audit', label: 'Audit Log' },
  { id: 'access', label: 'Access & Roles' },
  { id: 'health', label: 'System Health' },
  { id: 'exports', label: 'Data Export' },
];

const ROLE_PERMISSIONS = [
  { key: 'view', label: 'View records', owner: true, admin: true, manager: true, analyst: true, viewer: true },
  { key: 'create', label: 'Create records', owner: true, admin: true, manager: true, analyst: true, viewer: false },
  { key: 'edit', label: 'Edit records', owner: true, admin: true, manager: true, analyst: false, viewer: false },
  { key: 'delete', label: 'Delete records', owner: true, admin: true, manager: false, analyst: false, viewer: false },
  { key: 'export', label: 'Export data', owner: true, admin: true, manager: true, analyst: true, viewer: false },
  { key: 'users', label: 'Manage users', owner: true, admin: true, manager: false, analyst: false, viewer: false },
  { key: 'audit', label: 'View audit logs', owner: true, admin: true, manager: true, analyst: true, viewer: false },
  { key: 'settings', label: 'Manage settings', owner: true, admin: true, manager: false, analyst: false, viewer: false },
];

const ROLES = [
  { key: 'owner', label: 'Owner', note: 'Account and policy owner' },
  { key: 'admin', label: 'Admin', note: 'Operational administration' },
  { key: 'manager', label: 'Manager', note: 'Team-level operations' },
  { key: 'analyst', label: 'Analyst', note: 'Review and export workflows' },
  { key: 'viewer', label: 'Viewer', note: 'Read-only access model' },
];

const formatDateTime = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('tr-TR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
};

const normalizeStatus = (value) => {
  const raw = String(value || 'recorded').trim();
  if (!raw) return 'Recorded';
  if (/fail|error|denied|reject/i.test(raw)) return 'Failed';
  if (/pending|queued|progress/i.test(raw)) return 'Pending';
  if (/success|ok|complete|recorded/i.test(raw)) return 'Recorded';
  return raw.charAt(0).toUpperCase() + raw.slice(1);
};

const normalizeAuditEvent = (item, index, source) => {
  const actorUser = item?.actor_user || item?.actor || item?.user || {};
  const actor = actorUser?.username || actorUser?.email || item?.username || item?.user || item?.actor || 'system';
  const time = item?.created_at || item?.timestamp || item?.time || item?.at || item?.createdAt || '';
  const action = item?.action || item?.event || item?.type || 'activity.recorded';
  const resourceType = item?.object_type || item?.resource_type || item?.resource || item?.entity || item?.role || 'Application';
  const resourceId = item?.object_id || item?.resource_id || item?.id || '';
  const message = item?.message || item?.details || item?.detail || item?.description || '';

  return {
    id: item?.id || `${source}-${index}`,
    time,
    actor,
    action,
    resource: resourceId && resourceId !== item?.id ? `${resourceType} / ${resourceId}` : resourceType,
    status: normalizeStatus(item?.status || item?.result || item?.outcome),
    details: message || (item?.hash ? `Integrity hash: ${item.hash}` : 'Recorded activity'),
    source,
    raw: item,
  };
};

const getStatusVariant = (status) => {
  const value = String(status || '').toLowerCase();
  if (value.includes('failed') || value.includes('not connected')) return 'red';
  if (value.includes('pending') || value.includes('configured') || value.includes('readiness')) return 'amber';
  if (value.includes('available') || value.includes('recorded') || value.includes('ready')) return 'green';
  return 'default';
};

const SectionHeader = ({ id, title, description, action }) => (
  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
    <div className="min-w-0">
      <h2 id={id} className="text-lg font-semibold text-foreground">{title}</h2>
      <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
    </div>
    {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
  </div>
);

const EmptyState = ({ title, description, icon: Icon = ClipboardList }) => (
  <div className="ui-empty rounded-lg border border-border/70" role="status" aria-live="polite">
    <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg border border-border/70 bg-secondary/45">
      <Icon size={18} aria-hidden="true" />
    </div>
    <p className="text-sm font-medium text-foreground">{title}</p>
    <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted-foreground">{description}</p>
  </div>
);

const StatusBadge = ({ children }) => (
  <Badge variant={getStatusVariant(children)} className="whitespace-nowrap">
    {children}
  </Badge>
);

const ReadinessCard = ({ icon: Icon, title, status, description, detail }) => (
  <Card className="p-4">
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-secondary/45 text-muted-foreground">
        <Icon size={18} aria-hidden="true" />
      </div>
    </div>
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <StatusBadge>{status}</StatusBadge>
      {detail ? <span className="text-xs text-muted-foreground">{detail}</span> : null}
    </div>
  </Card>
);

function OverviewPanel({ auditEvents, localApiUrl }) {
  const hasAuditEvents = auditEvents.length > 0;
  const cards = [
    {
      icon: KeyRound,
      title: 'Access control',
      status: 'Readiness view',
      description: 'Review how access levels should map to operational capabilities.',
      detail: 'Backend policy integration required for enforcement.',
    },
    {
      icon: ClipboardList,
      title: 'Audit visibility',
      status: hasAuditEvents ? 'Available' : 'Not connected',
      description: hasAuditEvents
        ? 'Review operational activity across local and connected audit sources.'
        : 'Connect an audit endpoint to review user and system activity here.',
      detail: hasAuditEvents ? `${auditEvents.length} event${auditEvents.length === 1 ? '' : 's'} visible` : 'No audit events yet.',
    },
    {
      icon: FileSpreadsheet,
      title: 'Export readiness',
      status: 'Available',
      description: 'Excel export workflows are available through existing report actions.',
      detail: 'Export tracking is not connected.',
    },
    {
      icon: Server,
      title: 'System health',
      status: localApiUrl ? 'Configured, not checked' : 'Not connected',
      description: 'Connect a health endpoint to monitor live service availability.',
      detail: localApiUrl ? 'Endpoint setting exists; live status is not verified.' : 'No health endpoint configured.',
    },
    {
      icon: ShieldCheck,
      title: 'Data governance',
      status: 'Readiness view',
      description: 'Surface governance controls without implying backend retention policies.',
      detail: 'Retention and policy enforcement require backend controls.',
    },
  ];

  return (
    <section className="space-y-4" aria-labelledby="enterprise-overview-title">
      <SectionHeader
        id="enterprise-overview-title"
        title="Enterprise readiness overview"
        description="Review operational readiness areas without displaying unverified production metrics."
      />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
        {cards.map((card) => <ReadinessCard key={card.title} {...card} />)}
      </div>
    </section>
  );
}

function AuditLogPanel({ auditEvents, loading, onRefresh, canRefresh }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [periodFilter, setPeriodFilter] = useState('all');

  const actionOptions = useMemo(() => {
    const values = new Set(auditEvents.map((event) => event.action).filter(Boolean));
    return ['all', ...Array.from(values).sort((a, b) => a.localeCompare(b))];
  }, [auditEvents]);

  const statusOptions = useMemo(() => {
    const values = new Set(auditEvents.map((event) => event.status).filter(Boolean));
    return ['all', ...Array.from(values).sort((a, b) => a.localeCompare(b))];
  }, [auditEvents]);

  const filteredEvents = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    const now = Date.now();
    const periodMs = {
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
    }[periodFilter];

    return auditEvents.filter((event) => {
      if (actionFilter !== 'all' && event.action !== actionFilter) return false;
      if (statusFilter !== 'all' && event.status !== statusFilter) return false;
      if (periodMs) {
        const time = new Date(event.time).getTime();
        if (Number.isNaN(time) || now - time > periodMs) return false;
      }
      if (!query) return true;
      return [event.actor, event.action, event.resource, event.status, event.details, event.source]
        .some((value) => String(value || '').toLowerCase().includes(query));
    });
  }, [actionFilter, auditEvents, periodFilter, searchTerm, statusFilter]);

  return (
    <section className="space-y-4" aria-labelledby="enterprise-audit-title">
      <SectionHeader
        id="enterprise-audit-title"
        title="Audit log"
        description="Review operational activity across users, records, and exports when audit data is available."
        action={canRefresh ? (
          <Button onClick={onRefresh} variant="secondary" size="sm" className="gap-2" disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
            Refresh
          </Button>
        ) : null}
      />

      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <FormField label="Search" htmlFor="enterprise-audit-search">
            <Input
              id="enterprise-audit-search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search actor, action, resource"
              aria-label="Search audit events"
            />
          </FormField>
          <FormField label="Action" htmlFor="enterprise-audit-action">
            <Select id="enterprise-audit-action" value={actionFilter} onChange={(event) => setActionFilter(event.target.value)}>
              {actionOptions.map((action) => (
                <option key={action} value={action}>{action === 'all' ? 'All actions' : action}</option>
              ))}
            </Select>
          </FormField>
          <FormField label="Status" htmlFor="enterprise-audit-status">
            <Select id="enterprise-audit-status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              {statusOptions.map((status) => (
                <option key={status} value={status}>{status === 'all' ? 'All statuses' : status}</option>
              ))}
            </Select>
          </FormField>
          <FormField label="Period" htmlFor="enterprise-audit-period">
            <Select id="enterprise-audit-period" value={periodFilter} onChange={(event) => setPeriodFilter(event.target.value)}>
              <option value="all">All time</option>
              <option value="24h">Last 24 hours</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
            </Select>
          </FormField>
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        {loading ? (
          <div className="space-y-2 p-4" role="status" aria-live="polite" aria-label="Loading audit events">
            {[0, 1, 2, 3].map((row) => <div key={row} className="ui-skeleton h-10" />)}
          </div>
        ) : filteredEvents.length > 0 ? (
          <div className="ui-table-wrap border-0">
            <table className="ui-table">
              <thead>
                <tr>
                  <TableHeadCell label="Time" />
                  <TableHeadCell label="Actor" />
                  <TableHeadCell label="Action" />
                  <TableHeadCell label="Resource" />
                  <TableHeadCell label="Status" />
                  <TableHeadCell label="Details" />
                </tr>
              </thead>
              <tbody>
                {filteredEvents.map((event) => (
                  <tr key={event.id}>
                    <td className="whitespace-nowrap text-muted-foreground">{formatDateTime(event.time)}</td>
                    <td className="font-medium text-foreground">{event.actor}</td>
                    <td><code className="rounded bg-secondary/55 px-1.5 py-0.5 text-xs">{event.action}</code></td>
                    <td className="text-muted-foreground">{event.resource}</td>
                    <td><StatusBadge>{event.status}</StatusBadge></td>
                    <td className="max-w-[360px] break-words text-muted-foreground">{event.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : auditEvents.length > 0 ? (
          <EmptyState
            icon={Filter}
            title="No audit events match the current filters."
            description="Adjust the search, action, status, or period filters to widen the audit review."
          />
        ) : (
          <EmptyState
            title="No audit events available yet."
            description="Connect an audit endpoint to review user and system activity here."
          />
        )}
      </Card>
    </section>
  );
}

function AccessRolesPanel() {
  return (
    <section className="space-y-4" aria-labelledby="enterprise-access-title">
      <SectionHeader
        id="enterprise-access-title"
        title="Access & roles"
        description="Configure how access levels should map to product capabilities. Permission enforcement requires backend policy integration."
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
        {ROLES.map((role) => (
          <Card key={role.key} className="p-4">
            <div className="flex items-center gap-2">
              <Users size={16} className="text-muted-foreground" aria-hidden="true" />
              <h3 className="text-sm font-semibold text-foreground">{role.label}</h3>
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{role.note}</p>
          </Card>
        ))}
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="border-b border-border/70 p-4">
          <Badge variant="amber">Readiness / configuration view</Badge>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            This matrix documents recommended access mapping. It does not imply server-side enforcement.
          </p>
        </div>
        <div className="ui-table-wrap border-0">
          <table className="ui-table">
            <thead>
              <tr>
                <TableHeadCell label="Permission" />
                {ROLES.map((role) => <TableHeadCell key={role.key} label={role.label} />)}
              </tr>
            </thead>
            <tbody>
              {ROLE_PERMISSIONS.map((permission) => (
                <tr key={permission.key}>
                  <td className="font-medium text-foreground">{permission.label}</td>
                  {ROLES.map((role) => {
                    const enabled = permission[role.key];
                    return (
                      <td key={role.key}>
                        <span className={cx(
                          'inline-flex items-center gap-2 rounded-md border px-2 py-1 text-xs',
                          enabled
                            ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'
                            : 'border-border/70 bg-secondary/45 text-muted-foreground'
                        )}>
                          {enabled ? <CheckCircle size={13} aria-hidden="true" /> : <AlertCircle size={13} aria-hidden="true" />}
                          {enabled ? 'Mapped' : 'Not mapped'}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </section>
  );
}

function SystemHealthPanel({ localApiUrl }) {
  const endpointLabel = localApiUrl ? localApiUrl.replace(/^https?:\/\//, '') : '';
  const rows = [
    {
      service: 'API status',
      status: localApiUrl ? 'Configured, not checked' : 'Not connected',
      detail: localApiUrl ? `Configured endpoint: ${endpointLabel}` : 'Connect a health endpoint to monitor live service availability.',
      icon: Server,
    },
    {
      service: 'Database status',
      status: 'Not connected',
      detail: 'No database health endpoint is exposed to the frontend.',
      icon: Database,
    },
    {
      service: 'Storage status',
      status: 'Not connected',
      detail: 'No storage health endpoint is exposed to the frontend.',
      icon: HardDrive,
    },
    {
      service: 'Export service status',
      status: 'Available',
      detail: 'Excel export is available through existing report actions; service health is not tracked.',
      icon: Download,
    },
    {
      service: 'Last successful check',
      status: 'Not connected',
      detail: 'No live health check has been completed from this screen.',
      icon: Activity,
    },
  ];

  return (
    <section className="space-y-4" aria-labelledby="enterprise-health-title">
      <SectionHeader
        id="enterprise-health-title"
        title="System health"
        description="Monitor live service availability when health endpoints are connected."
      />

      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {rows.map((row) => {
            const Icon = row.icon;
            return (
              <div key={row.service} className="ui-panel flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-secondary/45 text-muted-foreground">
                  <Icon size={16} aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-foreground">{row.service}</h3>
                    <StatusBadge>{row.status}</StatusBadge>
                  </div>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">{row.detail}</p>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <EmptyState
        icon={Server}
        title="Live health monitoring is not connected."
        description="Connect a backend health endpoint to replace these readiness placeholders with verified service status."
      />
    </section>
  );
}

function ExportReadinessPanel() {
  const exportRows = [
    { label: 'Supported export formats', value: 'Excel (.xlsx)' },
    { label: 'Last export status', value: 'Not tracked in Enterprise Center' },
    { label: 'Export limits', value: 'No frontend-visible limit configured' },
    { label: 'Security note', value: 'Export controls help teams manage operational data safely.' },
  ];

  return (
    <section className="space-y-4" aria-labelledby="enterprise-export-title">
      <SectionHeader
        id="enterprise-export-title"
        title="Data export readiness"
        description="Review available export capabilities and identify controls that require backend integration."
      />
      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {exportRows.map((row) => (
            <div key={row.label} className="ui-panel">
              <p className="text-xs font-medium text-muted-foreground">{row.label}</p>
              <p className="mt-1 text-sm font-medium text-foreground">{row.value}</p>
            </div>
          ))}
        </div>
      </Card>
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <FileSpreadsheet size={18} className="mt-0.5 text-muted-foreground" aria-hidden="true" />
          <div>
            <h3 className="text-sm font-semibold text-foreground">Existing export behavior preserved</h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              This view does not import export libraries or run export jobs. Existing report export actions remain responsible for file generation.
            </p>
          </div>
        </div>
      </Card>
    </section>
  );
}

export default function EnterpriseCenter({
  auditLogs = [],
  serverAuditLogs = [],
  serverAuditLoading = false,
  onRefreshAuditLogs,
  canRefreshAuditLogs = false,
  localApiUrl = '',
  session,
  activeRole = '',
}) {
  const [activeSection, setActiveSection] = useState('overview');

  const auditEvents = useMemo(() => {
    const serverEvents = Array.isArray(serverAuditLogs)
      ? serverAuditLogs.map((item, index) => normalizeAuditEvent(item, index, 'server'))
      : [];
    const localEvents = Array.isArray(auditLogs)
      ? auditLogs.map((item, index) => normalizeAuditEvent(item, index, 'local'))
      : [];
    return [...serverEvents, ...localEvents].sort((a, b) => {
      const left = new Date(a.time).getTime();
      const right = new Date(b.time).getTime();
      if (Number.isNaN(left) && Number.isNaN(right)) return 0;
      if (Number.isNaN(left)) return 1;
      if (Number.isNaN(right)) return -1;
      return right - left;
    });
  }, [auditLogs, serverAuditLogs]);

  const userLabel = session?.user?.username || session?.user?.email || 'Signed-in workspace';

  return (
    <main className="space-y-6">
      <section className="space-y-4" aria-labelledby="enterprise-center-title">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge variant="blue">Enterprise Center</Badge>
              <span className="text-xs text-muted-foreground">{userLabel} · {activeRole || 'role not set'}</span>
            </div>
            <h1 id="enterprise-center-title" className="text-2xl font-semibold tracking-normal text-foreground">
              Enterprise readiness center
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              Review access mapping, audit visibility, health readiness, and export controls from one operational workspace.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Enterprise Center sections">
          {SECTION_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeSection === tab.id}
              aria-controls={`enterprise-section-${tab.id}`}
              className={cx(
                'ui-btn ui-btn-secondary px-3 py-1.5 text-xs',
                activeSection === tab.id && 'border-primary/50 bg-primary/10 text-primary'
              )}
              onClick={() => setActiveSection(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      <div id={`enterprise-section-${activeSection}`} role="tabpanel" tabIndex={0}>
        {activeSection === 'overview' && <OverviewPanel auditEvents={auditEvents} localApiUrl={localApiUrl} />}
        {activeSection === 'audit' && (
          <AuditLogPanel
            auditEvents={auditEvents}
            loading={serverAuditLoading}
            onRefresh={onRefreshAuditLogs}
            canRefresh={canRefreshAuditLogs}
          />
        )}
        {activeSection === 'access' && <AccessRolesPanel />}
        {activeSection === 'health' && <SystemHealthPanel localApiUrl={localApiUrl} />}
        {activeSection === 'exports' && <ExportReadinessPanel />}
      </div>
    </main>
  );
}
