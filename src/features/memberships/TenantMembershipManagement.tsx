import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { OrganizationScope, Hospital, Department, TenantMembership, TenantMembershipScopeInput, TenantRole } from "../../api/heapcare";
import {
  ApiError,
  createTenantMembership,
  deactivateTenantMembership,
  listDepartments,
  listTenantMemberships,
  listTenantRoles,
  reactivateTenantMembership,
  updateTenantMembership
} from "../../api/heapcare";


interface ScopeEditorProps {
  value: OrganizationScope[];
  onChange: (scopes: OrganizationScope[]) => void;
  allowedScopeTypes: OrganizationScope["scopeType"][];
  hospitals: Hospital[];
  departmentsByHospital: Record<string, Department[]>;
  onLoadDepartments: (hospitalId: string) => void;
  disabled: boolean;
  idPrefix: string;
}

function chooseLeastPrivilegeRole(roleOptions: TenantRole[]): string {
  return [...roleOptions]
    .filter(role => role.isActive)
    .sort((left, right) =>
      left.permissionCodes.length - right.permissionCodes.length ||
      left.name.localeCompare(right.name))[0]?.code ?? "";
}

function createScope(type: OrganizationScope["scopeType"], hospitalId: string | null = null): OrganizationScope {
  return { scopeType: type, hospitalId: type === "Tenant" ? null : hospitalId, departmentId: null };
}

function ScopeEditor({
  value, onChange, allowedScopeTypes, hospitals, departmentsByHospital, onLoadDepartments, disabled, idPrefix
}: ScopeEditorProps) {
  useEffect(() => {
    value.filter(scope => scope.scopeType === "Department" && scope.hospitalId)
      .forEach(scope => onLoadDepartments(scope.hospitalId!));
  }, [value, onLoadDepartments]);

  function changeType(index: number, type: OrganizationScope["scopeType"]) {
    if (type === "Tenant") {
      onChange([createScope("Tenant")]);
      return;
    }
    const next = [...value];
    next[index] = createScope(type, next[index]?.hospitalId ?? hospitals[0]?.id ?? null);
    onChange(next);
  }

  function changeScope(index: number, patch: Partial<OrganizationScope>) {
    onChange(value.map((scope, position) => position === index ? { ...scope, ...patch } : scope));
  }

  function addScope() {
    if (value.length >= 25 || value.some(scope => scope.scopeType === "Tenant")) return;
    const type = allowedScopeTypes.includes("Hospital") ? "Hospital" : "Department";
    onChange([...value, createScope(type, hospitals[0]?.id ?? null)]);
  }

  return <div className="membership-scope-editor">
    {value.map((scope, index) => {
      const hospitalId = scope.hospitalId ?? "";
      const departments = hospitalId ? departmentsByHospital[hospitalId] ?? [] : [];
      return <div className="membership-scope-row" key={index}>
        <div>
          <label htmlFor={`${idPrefix}-scope-type-${index}`}>Scope type</label>
          <select id={`${idPrefix}-scope-type-${index}`} value={scope.scopeType} disabled={disabled}
            onChange={event => changeType(index, event.target.value as OrganizationScope["scopeType"])}>
            {allowedScopeTypes.map(type => <option key={type} value={type}>{type === "Tenant" ? "Entire tenant" : type}</option>)}
          </select>
        </div>
        {scope.scopeType !== "Tenant" && <div>
          <label htmlFor={`${idPrefix}-scope-hospital-${index}`}>Hospital</label>
          <select id={`${idPrefix}-scope-hospital-${index}`} value={hospitalId} disabled={disabled || hospitals.length === 0}
            onChange={event => {
              changeScope(index, { hospitalId: event.target.value || null, departmentId: null });
              if (scope.scopeType === "Department" && event.target.value) onLoadDepartments(event.target.value);
            }}>
            <option value="">Choose hospital</option>
            {hospitals.map(hospital => <option key={hospital.id} value={hospital.id}>{hospital.name}</option>)}
          </select>
        </div>}
        {scope.scopeType === "Department" && <div>
          <label htmlFor={`${idPrefix}-scope-department-${index}`}>Department</label>
          <select id={`${idPrefix}-scope-department-${index}`} value={scope.departmentId ?? ""}
            disabled={disabled || !hospitalId || !departmentsByHospital[hospitalId]}
            onChange={event => changeScope(index, { departmentId: event.target.value || null })}>
            <option value="">Choose department</option>
            {departments.map(department => <option key={department.id} value={department.id}>{department.name}{department.code ? ` · ${department.code}` : ""}</option>)}
          </select>
        </div>}
        {value.length > 1 && <button type="button" className="queue-action-danger membership-remove-scope"
          onClick={() => onChange(value.filter((_, position) => position !== index))} disabled={disabled}>Remove scope</button>}
      </div>;
    })}
    {!value.some(scope => scope.scopeType === "Tenant") && value.length < 25 &&
      <button type="button" className="clinical-secondary membership-add-scope" onClick={addScope} disabled={disabled || hospitals.length === 0}>Add another scope</button>}
    {value.some(scope => scope.scopeType === "Tenant") && <p className="helper-text">Tenant-wide access is exclusive and cannot be combined with hospital or department scopes.</p>}
  </div>;
}

interface Props {
  baseUrl: string;
  accessToken: string;
  tenantId: string;
  currentIssuer: string;
  currentSubject: string;
  permissions: string[];
  scopes: OrganizationScope[];
  hospitals: Hospital[];
  roleRevision: number;
  onBusyChange: (busy: boolean) => void;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409) return "The membership changed or a protected administrator rule prevents this action. Refresh and review the current assignments.";
    return error.message;
  }
  return error instanceof Error ? error.message : "The membership request could not be completed.";
}

function formatScope(scope: OrganizationScope, hospitals: Hospital[], departmentsByHospital: Record<string, Department[]>): string {
  if (scope.scopeType === "Tenant") return "Entire tenant";
  const hospital = hospitals.find(item => item.id === scope.hospitalId);
  const hospitalName = hospital?.name ?? "Hospital";
  if (scope.scopeType === "Hospital") return hospitalName;
  const department = scope.hospitalId
    ? departmentsByHospital[scope.hospitalId]?.find(item => item.id === scope.departmentId)
    : undefined;
  return `${hospitalName} · ${department?.name ?? "Department"}`;
}

export function TenantMembershipManagement({
  baseUrl, accessToken, tenantId, currentIssuer, currentSubject, permissions, scopes, hospitals, roleRevision, onBusyChange
}: Props) {
  const canManage = permissions.includes("membership.manage");
  const tenantWide = scopes.some(scope => scope.scopeType === "Tenant");
  const hospitalScoped = scopes.some(scope => scope.scopeType === "Hospital");
  const allowedScopeTypes = useMemo<OrganizationScope["scopeType"][]>(() =>
    tenantWide ? ["Tenant", "Hospital", "Department"] : hospitalScoped ? ["Hospital", "Department"] : ["Department"],
  [tenantWide, hospitalScoped]);

  const [memberships, setMemberships] = useState<TenantMembership[]>([]);
  const [roleOptions, setRoleOptions] = useState<TenantRole[]>([]);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [departmentsByHospital, setDepartmentsByHospital] = useState<Record<string, Department[]>>({});
  const [departmentLoads, setDepartmentLoads] = useState<string[]>([]);

  const [newSubject, setNewSubject] = useState("");
  const [newRole, setNewRole] = useState("");
  const [newScopes, setNewScopes] = useState<OrganizationScope[]>([]);
  const [editingId, setEditingId] = useState("");
  const [editingRole, setEditingRole] = useState("");
  const [editingScopes, setEditingScopes] = useState<OrganizationScope[]>([]);
  const [confirmTarget, setConfirmTarget] = useState<{ id: string; subject: string; active: boolean } | null>(null);

  const departmentScopeKey = [...newScopes, ...editingScopes, ...memberships.flatMap(membership => membership.scopes)]
    .filter(scope => scope.scopeType === "Department" && scope.hospitalId)
    .map(scope => scope.hospitalId!)
    .filter((id, index, all) => all.indexOf(id) === index)
    .sort()
    .join("|");

  async function loadDepartmentsForHospital(hospitalId: string) {
    if (!hospitalId || departmentsByHospital[hospitalId] || departmentLoads.includes(hospitalId)) return;
    setDepartmentLoads(current => [...current, hospitalId]);
    try {
      const result = await listDepartments(baseUrl, accessToken, tenantId, hospitalId);
      setDepartmentsByHospital(current => ({ ...current, [hospitalId]: result.items }));
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      setDepartmentLoads(current => current.filter(id => id !== hospitalId));
    }
  }

  useEffect(() => {
    if (!newScopes.length) {
      const defaultType: OrganizationScope["scopeType"] = allowedScopeTypes.includes("Hospital") ? "Hospital" : "Department";
      const firstDepartmentScope = scopes.find(scope => scope.scopeType === "Department");
      setNewScopes([{
        scopeType: defaultType,
        hospitalId: hospitals[0]?.id ?? firstDepartmentScope?.hospitalId ?? null,
        departmentId: defaultType === "Department" ? firstDepartmentScope?.departmentId ?? null : null
      }]);
    }
  }, [allowedScopeTypes, hospitals, scopes, newScopes.length]);

  useEffect(() => {
    departmentScopeKey.split("|").filter(Boolean).forEach(id => { void loadDepartmentsForHospital(id); });
  }, [departmentScopeKey]);

  async function refreshMemberships() {
    setLoading(true);
    setError("");
    try {
      const result = await listTenantMemberships(baseUrl, accessToken, tenantId, page);
      setMemberships(result.items);
      setTotalCount(result.totalCount);
      setTotalPages(result.totalPages);
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
      listTenantMemberships(baseUrl, accessToken, tenantId, page),
      listTenantRoles(baseUrl, accessToken, tenantId)
    ])
      .then(([result, availableRoles]) => {
        if (!active) return;
        setMemberships(result.items);
        setTotalCount(result.totalCount);
        setTotalPages(result.totalPages);
        setRoleOptions(availableRoles);
        setNewRole(current => current && availableRoles.some(role => role.code === current && role.isActive)
          ? current
          : chooseLeastPrivilegeRole(availableRoles));
      })
      .catch(cause => { if (active) setError(getErrorMessage(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [baseUrl, accessToken, tenantId, page, roleRevision]);

  async function runMutation(action: () => Promise<void>, message: string) {
    setBusy(true);
    onBusyChange(true);
    setError("");
    setSuccess("");
    try {
      await action();
      await refreshMemberships();
      setSuccess(message);
      setEditingId("");
      setConfirmTarget(null);
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }

  function toScopeInputs(value: OrganizationScope[]): TenantMembershipScopeInput[] {
    return value.map(scope => ({
      scopeType: scope.scopeType,
      hospitalId: scope.scopeType === "Tenant" ? null : scope.hospitalId,
      departmentId: scope.scopeType === "Department" ? scope.departmentId : null
    }));
  }

  function validScopes(value: OrganizationScope[]): boolean {
    if (value.length === 0 || value.length > 25) return false;
    if (value.some(scope => scope.scopeType === "Tenant")) return value.length === 1;
    return value.every(scope => scope.scopeType === "Hospital"
      ? !!scope.hospitalId
      : !!scope.hospitalId && !!scope.departmentId);
  }

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentIssuer || !newSubject.trim() || !newRole || !validScopes(newScopes)) {
      setError("Enter the OIDC subject and complete at least one valid organization scope.");
      return;
    }
    await runMutation(async () => {
      await createTenantMembership(baseUrl, accessToken, tenantId, {
        issuer: currentIssuer,
        subject: newSubject.trim(),
        role: newRole,
        scopes: toScopeInputs(newScopes)
      });
      setNewSubject("");
      setNewRole(chooseLeastPrivilegeRole(roleOptions));
      setNewScopes([]);
    }, "Membership created.");
  }

  function beginEdit(membership: TenantMembership) {
    setEditingId(membership.id);
    setEditingRole(membership.role);
    setEditingScopes(membership.scopes.map(scope => ({ ...scope })));
    setError("");
    setSuccess("");
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const membership = memberships.find(item => item.id === editingId);
    if (!membership || !validScopes(editingScopes)) {
      setError("Complete all organization scopes before saving this membership.");
      return;
    }
    await runMutation(async () => {
      await updateTenantMembership(baseUrl, accessToken, tenantId, membership.id, {
        role: editingRole,
        scopes: toScopeInputs(editingScopes)
      });
    }, "Membership access updated.");
  }

  async function confirmLifecycleChange() {
    if (!confirmTarget) return;
    const target = confirmTarget;
    await runMutation(async () => {
      if (target.active) await deactivateTenantMembership(baseUrl, accessToken, tenantId, target.id);
      else await reactivateTenantMembership(baseUrl, accessToken, tenantId, target.id);
    }, target.active ? "Membership deactivated." : "Membership reactivated.");
  }

  if (!canManage) return null;

  return <section className="section membership-section" id="memberships">
    <div className="section-heading"><div><label>TENANT ACCESS</label><h2>Membership administration</h2><p className="helper-text">Manage tenant roles and organization scopes. Changes are audited by the API and never grant access outside your own administrative scope.</p></div></div>
    {error && <p className="inline-error" role="alert">{error}</p>}
    {success && <p className="registration-success" role="status">{success}</p>}

    <div className="search-panel membership-create-panel">
      <div className="membership-panel-heading"><div><h3>Add a membership</h3><p className="helper-text">The person must already exist in the configured identity provider. Use their exact OIDC subject, not their email address. HeapCare creates the tenant membership; it does not create identity-provider users.</p></div></div>
      <form onSubmit={submitCreate} className="membership-create-form">
        <div><label htmlFor="membership-issuer">Identity issuer</label><input id="membership-issuer" value={currentIssuer} readOnly disabled/></div>
        <div><label htmlFor="membership-subject">OIDC subject *</label><input id="membership-subject" value={newSubject} onChange={event=>setNewSubject(event.target.value)} maxLength={255} required disabled={busy}/></div>
        <div><label htmlFor="membership-role">Tenant role</label><select id="membership-role" value={newRole} onChange={event=>setNewRole(event.target.value)} disabled={busy || roleOptions.filter(role => role.isActive).length === 0}><option value="">Choose an available role</option>{roleOptions.filter(role => role.isActive).map(role=><option key={role.code} value={role.code}>{role.name}</option>)}</select></div>
        <div className="membership-scope-section"><strong>Organization scope</strong><ScopeEditor value={newScopes} onChange={setNewScopes} allowedScopeTypes={allowedScopeTypes} hospitals={hospitals} departmentsByHospital={departmentsByHospital} onLoadDepartments={loadDepartmentsForHospital} disabled={busy} idPrefix="membership-create"/></div>
        <div className="membership-form-actions"><button type="submit" disabled={busy || !currentIssuer || !newSubject.trim() || !newRole || !validScopes(newScopes)}>{busy ? "Saving…" : "Create membership"}</button></div>
      </form>
    </div>

    <div className="membership-list-panel">
      <div className="membership-panel-heading"><div><h3>Current memberships</h3><p className="helper-text">{totalCount} membership{totalCount === 1 ? "" : "s"} in your manageable scope</p></div><button type="button" className="clinical-secondary" onClick={refreshMemberships} disabled={loading || busy}>Refresh</button></div>
      {loading ? <p className="inline-status" role="status">Loading memberships…</p> : memberships.length === 0 ? <p className="inline-status">No memberships are available in your administrative scope.</p> :
        <div className="membership-list">{memberships.map(membership => {
          const isSelf = membership.issuer === currentIssuer && membership.subject === currentSubject;
          return <article className="membership-card" key={membership.id}>
            <div className="membership-card-main">
              <div><strong>{membership.subject}</strong>{isSelf && <span className="membership-self">Your account</span>}<small>{membership.issuer}</small></div>
              <span className={membership.isActive ? "membership-status membership-status-active" : "membership-status membership-status-inactive"}>{membership.isActive ? "Active" : "Inactive"}</span>
            </div>
            <div className="membership-card-meta"><span>Role: <strong>{membership.role}</strong></span><span>{membership.scopes.map(scope => formatScope(scope, hospitals, departmentsByHospital)).join(" · ")}</span></div>
            {editingId === membership.id ? <form className="membership-edit-form" onSubmit={submitEdit}>
              <div><label htmlFor={`membership-role-${membership.id}`}>Role</label><select id={`membership-role-${membership.id}`} value={editingRole} onChange={event=>setEditingRole(event.target.value)} disabled={busy}>
                {!roleOptions.some(role => role.code === editingRole && role.isActive) && <option value={editingRole} disabled>{editingRole} · current assignment (not delegable)</option>}
                {roleOptions.filter(role => role.isActive).map(role=><option key={role.code} value={role.code}>{role.name}</option>)}
              </select></div>
              <div className="membership-scope-section"><strong>Organization scopes</strong><ScopeEditor value={editingScopes} onChange={setEditingScopes} allowedScopeTypes={allowedScopeTypes} hospitals={hospitals} departmentsByHospital={departmentsByHospital} onLoadDepartments={loadDepartmentsForHospital} disabled={busy} idPrefix={`membership-edit-${membership.id}`}/></div>
              <div className="membership-form-actions"><button type="submit" disabled={busy || isSelf || !validScopes(editingScopes)}>Save access</button><button type="button" className="clinical-secondary" onClick={()=>setEditingId("")} disabled={busy}>Cancel</button></div>
            </form> : <div className="membership-actions">
              <button type="button" className="clinical-secondary" onClick={()=>beginEdit(membership)} disabled={busy || isSelf}>Edit access</button>
              {membership.isActive
                ? <button type="button" className="queue-action-danger" onClick={()=>setConfirmTarget({id:membership.id,subject:membership.subject,active:true})} disabled={busy || isSelf}>Deactivate</button>
                : <button type="button" className="clinical-secondary" onClick={()=>setConfirmTarget({id:membership.id,subject:membership.subject,active:false})} disabled={busy || isSelf}>Reactivate</button>}
            </div>}
            {confirmTarget?.id === membership.id && <div className="membership-confirm" role="group" aria-labelledby={`membership-confirm-${membership.id}`}>
              <p id={`membership-confirm-${membership.id}`}>{confirmTarget.active ? "Deactivate" : "Reactivate"} membership for <strong>{confirmTarget.subject}</strong>?</p>
              <div className="membership-form-actions"><button type="button" className={confirmTarget.active ? "queue-action-danger" : ""} onClick={confirmLifecycleChange} disabled={busy}>{confirmTarget.active ? "Confirm deactivation" : "Confirm reactivation"}</button><button type="button" className="clinical-secondary" onClick={()=>setConfirmTarget(null)} disabled={busy}>Cancel</button></div>
            </div>}
          </article>;
        })}</div>}
      {totalPages > 1 && <div className="pagination"><button type="button" onClick={()=>setPage(current=>Math.max(1,current-1))} disabled={loading||page<=1}>Previous</button><span>Page {page} of {totalPages}</span><button type="button" onClick={()=>setPage(current=>Math.min(totalPages,current+1))} disabled={loading||page>=totalPages}>Next</button></div>}
    </div>
  </section>;
}
