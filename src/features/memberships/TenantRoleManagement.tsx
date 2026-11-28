import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  ApiError,
  createTenantRole,
  deactivateTenantRole,
  listAssignableTenantPermissions,
  listTenantRoles,
  reactivateTenantRole,
  updateTenantRole
} from "../../api/heapcare";
import type { TenantPermissionDefinition, TenantRole, TenantRoleInput } from "../../api/heapcare";
import type { OrganizationScope } from "../../api/heapcare";

interface Props {
  baseUrl: string;
  accessToken: string;
  tenantId: string;
  permissions: string[];
  scopes: OrganizationScope[];
  onBusyChange: (busy: boolean) => void;
  onRolesChanged: () => void;
}

type EditorMode = "create" | "edit";

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return "Your membership cannot delegate one or more of these permissions.";
    if (error.status === 409) return "The role could not be changed. It may have active memberships or have changed concurrently.";
    return error.message;
  }
  return error instanceof Error ? error.message : "The role request could not be completed.";
}

function riskLabel(risk: TenantPermissionDefinition["risk"]): string {
  if (typeof risk === "number") return ["Standard", "Sensitive", "Critical"][risk] ?? "Unclassified";
  return risk;
}

export function TenantRoleManagement({
  baseUrl,
  accessToken,
  tenantId,
  permissions,
  scopes,
  onBusyChange,
  onRolesChanged
}: Props) {
  const canManageMemberships = permissions.includes("membership.manage");
  const tenantWide = scopes.some(scope => scope.scopeType === "Tenant");

  const [roles, setRoles] = useState<TenantRole[]>([]);
  const [permissionDefinitions, setPermissionDefinitions] = useState<TenantPermissionDefinition[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [editorMode, setEditorMode] = useState<EditorMode | null>(null);
  const [editingRoleId, setEditingRoleId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [lifecycleTarget, setLifecycleTarget] = useState<{ role: TenantRole; active: boolean } | null>(null);
  const [lifecycleReason, setLifecycleReason] = useState("");

  const definitionsByModule = useMemo(() => {
    const grouped = new Map<string, TenantPermissionDefinition[]>();
    for (const definition of permissionDefinitions) {
      const current = grouped.get(definition.module) ?? [];
      current.push(definition);
      grouped.set(definition.module, current);
    }
    return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [permissionDefinitions]);

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const [roleItems, permissionItems] = await Promise.all([
        listTenantRoles(baseUrl, accessToken, tenantId),
        listAssignableTenantPermissions(baseUrl, accessToken, tenantId)
      ]);
      setRoles(roleItems);
      setPermissionDefinitions(permissionItems);
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      listTenantRoles(baseUrl, accessToken, tenantId),
      listAssignableTenantPermissions(baseUrl, accessToken, tenantId)
    ])
      .then(([roleItems, permissionItems]) => {
        if (!active) return;
        setRoles(roleItems);
        setPermissionDefinitions(permissionItems);
      })
      .catch(cause => { if (active) setError(getErrorMessage(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [baseUrl, accessToken, tenantId]);

  function resetEditor() {
    setEditorMode(null);
    setEditingRoleId("");
    setName("");
    setDescription("");
    setSelectedPermissions([]);
    setReason("");
  }

  function beginCreate() {
    resetEditor();
    setEditorMode("create");
    setError("");
    setSuccess("");
  }

  function beginEdit(role: TenantRole) {
    if (role.isSystem || !tenantWide) return;
    setEditorMode("edit");
    setEditingRoleId(role.id);
    setName(role.name);
    setDescription(role.description);
    setSelectedPermissions([...role.permissionCodes]);
    setReason("");
    setError("");
    setSuccess("");
    setLifecycleTarget(null);
  }

  function togglePermission(code: string, checked: boolean) {
    setSelectedPermissions(current => {
      if (checked) return current.includes(code) ? current : [...current, code].sort();
      return current.filter(value => value !== code);
    });
  }

  async function submitRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenantWide || !name.trim() || !description.trim() ||
        !reason.trim() || reason.trim().length < 10 || selectedPermissions.length === 0) {
      setError("Enter a role name, description, at least one permission and a reason of at least 10 characters.");
      return;
    }

    const input: TenantRoleInput = {
      name: name.trim(),
      description: description.trim(),
      permissionCodes: selectedPermissions,
      reason: reason.trim()
    };

    setBusy(true);
    onBusyChange(true);
    setError("");
    setSuccess("");
    try {
      if (editorMode === "create") {
        await createTenantRole(baseUrl, accessToken, tenantId, input);
        setSuccess("Custom role created.");
      } else if (editorMode === "edit" && editingRoleId) {
        await updateTenantRole(baseUrl, accessToken, tenantId, editingRoleId, input);
        setSuccess("Role permissions updated. Existing members will receive the new grants on their next API request.");
      }
      resetEditor();
      await refresh();
      onRolesChanged();
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }

  async function confirmLifecycle() {
    if (!lifecycleTarget || !lifecycleReason.trim() || lifecycleReason.trim().length < 10) {
      setError("Enter a reason of at least 10 characters.");
      return;
    }

    const target = lifecycleTarget;
    setBusy(true);
    onBusyChange(true);
    setError("");
    setSuccess("");
    try {
      if (target.active) {
        await deactivateTenantRole(baseUrl, accessToken, tenantId, target.role.id, lifecycleReason.trim());
        setSuccess("Custom role deactivated.");
      } else {
        await reactivateTenantRole(baseUrl, accessToken, tenantId, target.role.id, lifecycleReason.trim());
        setSuccess("Custom role reactivated.");
      }
      setLifecycleTarget(null);
      setLifecycleReason("");
      await refresh();
      onRolesChanged();
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }

  if (!canManageMemberships) return null;

  return <section className="section tenant-roles-section" id="tenant-roles">
    <div className="section-heading">
      <div>
        <label>TENANT ACCESS CONTROL</label>
        <h2>Roles and permissions</h2>
        <p className="helper-text">Configure custom role grants for this hospital organization. Every change is attributed and audited by the API.</p>
      </div>
      {tenantWide && <button type="button" onClick={beginCreate} disabled={busy || !!editorMode}>Create custom role</button>}
    </div>

    {error && <p className="inline-error" role="alert">{error}</p>}
    {success && <p className="registration-success" role="status">{success}</p>}

    {!tenantWide && <p className="inline-status" role="status">
      You can view roles available for your delegated permissions, but role definitions apply across the entire Tenant. Only a Tenant-scoped administrator can create or change role definitions.
    </p>}

    {editorMode && tenantWide && <form className="search-panel tenant-role-editor" onSubmit={submitRole}>
      <div className="membership-panel-heading">
        <div>
          <h3>{editorMode === "create" ? "Create a custom role" : "Edit custom role"}</h3>
          <p className="helper-text">Only permissions already delegated to your membership are available. The API validates every permission again when saving.</p>
        </div>
      </div>
      <div className="tenant-role-fields">
        <div>
          <label htmlFor="tenant-role-name">Role name *</label>
          <input id="tenant-role-name" value={name} onChange={event => setName(event.target.value)} maxLength={100} required disabled={busy}/>
        </div>
        <div>
          <label htmlFor="tenant-role-description">Description *</label>
          <textarea id="tenant-role-description" value={description} onChange={event => setDescription(event.target.value)} maxLength={500} rows={2} required disabled={busy}/>
        </div>
      </div>

      <div className="tenant-role-permissions">
        <div className="tenant-role-permissions-heading">
          <div><h4>Module permissions</h4><p className="helper-text">Select only the operations required for this role.</p></div>
          <strong>{selectedPermissions.length} selected</strong>
        </div>
        {definitionsByModule.map(([module, definitions]) => <section className="tenant-role-module" key={module} aria-labelledby={`permission-module-${module.replace(/[^a-z0-9]+/gi, "-")}`}>
          <h5 id={`permission-module-${module.replace(/[^a-z0-9]+/gi, "-")}`}>{module}</h5>
          <div className="tenant-role-permission-grid">
            {definitions.map(definition => {
              const checked = selectedPermissions.includes(definition.code);
              return <label className="tenant-role-permission" key={definition.code}>
                <input type="checkbox" checked={checked} onChange={event => togglePermission(definition.code, event.target.checked)} disabled={busy}/>
                <span>
                  <strong>{definition.displayName}</strong>
                  <small>{definition.description}</small>
                  <span className={`tenant-role-risk tenant-role-risk-${riskLabel(definition.risk).toLowerCase()}`}>{riskLabel(definition.risk)}</span>
                </span>
              </label>;
            })}
          </div>
        </section>)}
        {permissionDefinitions.length === 0 && <p className="inline-status">No additional permissions are available for delegation by your membership.</p>}
      </div>

      <div>
        <label htmlFor="tenant-role-reason">Reason for this change *</label>
        <textarea id="tenant-role-reason" value={reason} onChange={event => setReason(event.target.value)} maxLength={500} minLength={10} rows={2} required disabled={busy}/>
        <small className="helper-text">At least 10 characters. The reason and before/after role configuration are retained in the audit history.</small>
      </div>
      <div className="membership-form-actions">
        <button type="submit" disabled={busy || !name.trim() || !description.trim() || selectedPermissions.length === 0 || reason.trim().length < 10}>
          {busy ? "Saving…" : editorMode === "create" ? "Create role" : "Save role changes"}
        </button>
        <button type="button" className="clinical-secondary" onClick={resetEditor} disabled={busy}>Cancel</button>
      </div>
    </form>}

    <div className="membership-list-panel tenant-role-list-panel">
      <div className="membership-panel-heading">
        <div><h3>Available roles</h3><p className="helper-text">{roles.length} role{roles.length === 1 ? "" : "s"} available within your delegated authority</p></div>
        <button type="button" className="clinical-secondary" onClick={refresh} disabled={loading || busy}>Refresh</button>
      </div>
      {loading ? <p className="inline-status" role="status">Loading tenant roles…</p> :
        roles.length === 0 ? <p className="inline-status">No roles are available within your delegated permissions.</p> :
        <div className="tenant-role-list">
          {roles.map(role => <article className="tenant-role-card" key={role.id}>
            <div className="tenant-role-card-heading">
              <div>
                <strong>{role.name}</strong>
                <small>{role.code} · {role.isSystem ? "System role" : "Custom role"}</small>
              </div>
              <span className={role.isActive ? "membership-status membership-status-active" : "membership-status membership-status-inactive"}>{role.isActive ? "Active" : "Inactive"}</span>
            </div>
            <p>{role.description}</p>
            <div className="tenant-role-grants">
              {role.permissionCodes.map(code => {
                const definition = permissionDefinitions.find(item => item.code === code);
                return <span key={code} title={definition?.description ?? code}>{definition?.displayName ?? code}</span>;
              })}
            </div>
            <div className="tenant-role-card-actions">
              {role.isSystem ? <small className="helper-text">System roles are protected and cannot be edited.</small> :
                tenantWide && <>
                  <button type="button" className="clinical-secondary" onClick={() => beginEdit(role)} disabled={busy || !!editorMode || !role.isActive}>Edit role</button>
                  {role.isActive
                    ? <button type="button" className="queue-action-danger" onClick={() => {setLifecycleTarget({role,active:true});setLifecycleReason("");}} disabled={busy || !!editorMode}>Deactivate</button>
                    : <button type="button" className="clinical-secondary" onClick={() => {setLifecycleTarget({role,active:false});setLifecycleReason("");}} disabled={busy || !!editorMode}>Reactivate</button>}
                </>}
            </div>
            {lifecycleTarget?.role.id === role.id && <div className="tenant-role-confirm" role="group" aria-label={role.name + " lifecycle confirmation"}>
              <label htmlFor={`role-lifecycle-reason-${role.id}`}>Reason *</label>
              <textarea id={`role-lifecycle-reason-${role.id}`} value={lifecycleReason} onChange={event => setLifecycleReason(event.target.value)} minLength={10} maxLength={500} rows={2} disabled={busy}/>
              <div className="membership-form-actions">
                <button type="button" className={lifecycleTarget.active ? "queue-action-danger" : ""} onClick={confirmLifecycle} disabled={busy || lifecycleReason.trim().length < 10}>
                  {lifecycleTarget.active ? "Confirm deactivation" : "Confirm reactivation"}
                </button>
                <button type="button" className="clinical-secondary" onClick={() => setLifecycleTarget(null)} disabled={busy}>Cancel</button>
              </div>
            </div>}
          </article>)}
        </div>}
    </div>
  </section>;
}
