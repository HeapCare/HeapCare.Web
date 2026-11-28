export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

export interface OrganizationScope {
  scopeType: "Tenant" | "Hospital" | "Department";
  hospitalId: string | null;
  departmentId: string | null;
}

export interface UserTenantContext {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  role: string;
  scopes: OrganizationScope[];
  permissions: string[];
}

export interface TenantMembership {
  id: string;
  issuer: string;
  subject: string;
  role: string;
  isActive: boolean;
  createdAtUtc: string;
  updatedAtUtc: string;
  scopes: OrganizationScope[];
}

export interface TenantMembershipScopeInput {
  scopeType: OrganizationScope["scopeType"];
  hospitalId: string | null;
  departmentId: string | null;
}

export type TenantPermissionRisk = "Standard" | "Sensitive" | "Critical" | number;

export interface TenantPermissionDefinition {
  code: string;
  module: string;
  resource: string;
  action: string;
  displayName: string;
  description: string;
  risk: TenantPermissionRisk;
  isAssignable: boolean;
}

export interface TenantRole {
  id: string;
  code: string;
  name: string;
  description: string;
  isSystem: boolean;
  isActive: boolean;
  permissionCodes: string[];
  createdAtUtc: string;
  updatedAtUtc: string;
}

export interface TenantRoleInput {
  name: string;
  description: string;
  permissionCodes: string[];
  reason: string;
}

export interface Hospital {
  id: string;
  name: string;
  code: string | null;
}

export interface Patient {
  id: string;
  givenName: string;
  middleName: string | null;
  familyName: string | null;
  dateOfBirth: string | null;
  hospitalId: string;
  registeredAtUtc: string;
}

export interface PatientRegistrationInput {
  givenName: string;
  middleName: string | null;
  familyName: string | null;
  dateOfBirth: string | null;
}

export interface PatientDuplicateCandidate {
  patientId: string;
  givenName: string;
  middleName: string | null;
  familyName: string | null;
  dateOfBirth: string;
  registeredAtUtc: string;
  matchSignals: string[];
}

export interface PatientDuplicateCheck {
  evaluated: boolean;
  evaluationMessage: string | null;
  candidates: PatientDuplicateCandidate[];
  hasMoreCandidates: boolean;
}

export interface PatientIdentifier {
  id: string;
  patientId: string;
  hospitalId: string;
  typeCode: string;
  value: string;
  assignedAtUtc: string;
}

export interface PatientIdentifierLookup {
  patient: Patient;
  identifier: PatientIdentifier;
}

export interface PatientIdentifierPolicy {
  hospitalId: string;
  prefix: string;
  numberLength: number;
}

export interface PatientIdentifierPolicyInput {
  prefix: string;
  numberLength: number;
}

export class ApiError extends Error {
  constructor(readonly status: number) {
    super(status === 401 ? "Your sign-in session is not authorized for the API." :
      status === 403 ? "Your account does not have permission for this operation." :
      status === 404 ? "The requested hospital or resource was not found." :
      status === 409 ? "The record or availability changed. Refresh the data and try again." :
      status === 400 ? "Some information was not accepted. Review the entered values and try again." :
      "The API request could not be completed.");
    this.name = "ApiError";
  }
}

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

async function getJson<T>(
  baseUrl: string,
  path: string,
  accessToken: string,
  tenantId?: string
): Promise<T> {
  if (!baseUrl.trim()) throw new Error("The HeapCare API URL is not configured.");
  if (!accessToken.trim()) throw new Error("A valid API access token is not available. Sign in again.");

  const headers = new Headers({ Accept: "application/json", Authorization: `Bearer ${accessToken}` });
  if (tenantId) headers.set("X-Tenant-ID", tenantId);

  const response = await fetch(endpoint(baseUrl, path), {
    method: "GET",
    headers,
    cache: "no-store",
    credentials: "omit"
  });

  if (!response.ok) throw new ApiError(response.status);
  return response.json() as Promise<T>;
}

export function getCurrentUserTenantContexts(
  baseUrl: string,
  accessToken: string
): Promise<Page<UserTenantContext>> {
  return getJson(baseUrl, "/api/v1/me/tenant-contexts?page=1&pageSize=100", accessToken);
}

export function getHospitals(
  baseUrl: string,
  accessToken: string,
  tenantId: string
): Promise<Page<Hospital>> {
  return getJson(baseUrl, "/api/v1/hospitals?page=1&pageSize=100", accessToken, tenantId);
}

export function listTenantMemberships(
  baseUrl: string,
  accessToken: string,
  tenantId: string,
  page = 1
): Promise<Page<TenantMembership>> {
  const parameters = new URLSearchParams({ page: String(page), pageSize: "50" });
  return getJson(baseUrl, `/api/v1/tenant/memberships?${parameters.toString()}`, accessToken, tenantId);
}

export function createTenantMembership(
  baseUrl: string,
  accessToken: string,
  tenantId: string,
  input: { issuer: string; subject: string; role: string; scopes: TenantMembershipScopeInput[] }
): Promise<TenantMembership> {
  return postJson(baseUrl, "/api/v1/tenant/memberships", accessToken, tenantId, input);
}

export function updateTenantMembership(
  baseUrl: string,
  accessToken: string,
  tenantId: string,
  membershipId: string,
  input: { role: string; scopes: TenantMembershipScopeInput[] }
): Promise<TenantMembership> {
  return putJson(baseUrl, `/api/v1/tenant/memberships/${encodeURIComponent(membershipId)}`, accessToken, tenantId, input);
}

export function deactivateTenantMembership(
  baseUrl: string,
  accessToken: string,
  tenantId: string,
  membershipId: string
): Promise<TenantMembership> {
  return postJson(baseUrl, `/api/v1/tenant/memberships/${encodeURIComponent(membershipId)}/deactivate`, accessToken, tenantId);
}

export function reactivateTenantMembership(
  baseUrl: string,
  accessToken: string,
  tenantId: string,
  membershipId: string
): Promise<TenantMembership> {
  return postJson(baseUrl, `/api/v1/tenant/memberships/${encodeURIComponent(membershipId)}/reactivate`, accessToken, tenantId);
}

export function listTenantRoles(
  baseUrl: string,
  accessToken: string,
  tenantId: string
): Promise<TenantRole[]> {
  return getJson(baseUrl, "/api/v1/tenant/roles", accessToken, tenantId);
}

export function listAssignableTenantPermissions(
  baseUrl: string,
  accessToken: string,
  tenantId: string
): Promise<TenantPermissionDefinition[]> {
  return getJson(baseUrl, "/api/v1/tenant/roles/permissions", accessToken, tenantId);
}

export function createTenantRole(
  baseUrl: string,
  accessToken: string,
  tenantId: string,
  input: TenantRoleInput
): Promise<TenantRole> {
  return postJson(baseUrl, "/api/v1/tenant/roles", accessToken, tenantId, input);
}

export function updateTenantRole(
  baseUrl: string,
  accessToken: string,
  tenantId: string,
  roleId: string,
  input: TenantRoleInput
): Promise<TenantRole> {
  return putJson(baseUrl, `/api/v1/tenant/roles/${encodeURIComponent(roleId)}`, accessToken, tenantId, input);
}

export function deactivateTenantRole(
  baseUrl: string,
  accessToken: string,
  tenantId: string,
  roleId: string,
  reason: string
): Promise<TenantRole> {
  return postJson(baseUrl, `/api/v1/tenant/roles/${encodeURIComponent(roleId)}/deactivate`, accessToken, tenantId, { reason });
}

export function reactivateTenantRole(
  baseUrl: string,
  accessToken: string,
  tenantId: string,
  roleId: string,
  reason: string
): Promise<TenantRole> {
  return postJson(baseUrl, `/api/v1/tenant/roles/${encodeURIComponent(roleId)}/reactivate`, accessToken, tenantId, { reason });
}

export function searchPatients(
  baseUrl: string,
  accessToken: string,
  tenantId: string,
  hospitalId: string,
  query: string,
  page = 1
): Promise<Page<Patient>> {
  const parameters = new URLSearchParams({ query: query.trim(), page: String(page), pageSize: "25" });
  return getJson(
    baseUrl,
    `/api/v1/hospitals/${encodeURIComponent(hospitalId)}/patients?${parameters.toString()}`,
    accessToken,
    tenantId
  );
}


export function checkPatientDuplicateCandidates(
  baseUrl: string,
  accessToken: string,
  tenantId: string,
  hospitalId: string,
  input: PatientRegistrationInput
): Promise<PatientDuplicateCheck> {
  return postJson(
    baseUrl,
    `/api/v1/hospitals/${encodeURIComponent(hospitalId)}/patients/duplicate-candidates`,
    accessToken,
    tenantId,
    input
  );
}

export function registerPatient(
  baseUrl: string,
  accessToken: string,
  tenantId: string,
  hospitalId: string,
  input: PatientRegistrationInput
): Promise<Patient> {
  return postJson(
    baseUrl,
    `/api/v1/hospitals/${encodeURIComponent(hospitalId)}/patients`,
    accessToken,
    tenantId,
    input
  );
}

export function assignPatientMedicalRecordNumber(
  baseUrl: string,
  accessToken: string,
  tenantId: string,
  hospitalId: string,
  patientId: string
): Promise<PatientIdentifier> {
  return postJson(
    baseUrl,
    `/api/v1/hospitals/${encodeURIComponent(hospitalId)}/patients/${encodeURIComponent(patientId)}/identifiers/mrn`,
    accessToken,
    tenantId
  );
}

export function getPatientIdentifierPolicy(
  baseUrl: string,
  accessToken: string,
  tenantId: string,
  hospitalId: string
): Promise<PatientIdentifierPolicy> {
  return getJson(baseUrl, `/api/v1/hospitals/${encodeURIComponent(hospitalId)}/patient-identifier-policy`, accessToken, tenantId);
}

export function createPatientIdentifierPolicy(
  baseUrl: string,
  accessToken: string,
  tenantId: string,
  hospitalId: string,
  input: PatientIdentifierPolicyInput
): Promise<PatientIdentifierPolicy> {
  return postJson(baseUrl, `/api/v1/hospitals/${encodeURIComponent(hospitalId)}/patient-identifier-policy`, accessToken, tenantId, input);
}

export async function findPatientByMrn(
  baseUrl: string,
  accessToken: string,
  tenantId: string,
  hospitalId: string,
  medicalRecordNumber: string
): Promise<PatientIdentifierLookup> {
  const value = medicalRecordNumber.trim();
  if (!value) throw new Error("Enter a medical record number to search.");
  return getJson(
    baseUrl,
    `/api/v1/hospitals/${encodeURIComponent(hospitalId)}/patients/by-mrn/${encodeURIComponent(value)}`,
    accessToken,
    tenantId
  );
}

async function postJson<T>(
  baseUrl: string,
  path: string,
  accessToken: string,
  tenantId: string,
  body?: unknown
): Promise<T> {
  if (!baseUrl.trim()) throw new Error("The HeapCare API URL is not configured.");
  if (!accessToken.trim()) throw new Error("A valid API access token is not available. Sign in again.");
  if (!tenantId.trim()) throw new Error("Select an active tenant before continuing.");

  const headers = new Headers({
    Accept: "application/json",
    Authorization: `Bearer ${accessToken}`,
    "X-Tenant-ID": tenantId
  });
  if (body !== undefined) headers.set("Content-Type", "application/json");

  const response = await fetch(endpoint(baseUrl, path), {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    credentials: "omit"
  });

  if (!response.ok) throw new ApiError(response.status);
  return response.json() as Promise<T>;
}


export interface AvailabilitySession {
  id: string;
  hospitalId: string;
  departmentId: string;
  providerStaffId: string;
  localDate: string;
  startsAtUtc: string;
  endsAtUtc: string;
  slotDurationMinutes: number;
  timeZoneId: string;
  createdAtUtc: string;
}

export interface AppointmentSlot {
  startsAtUtc: string;
  endsAtUtc: string;
  isAvailable: boolean;
}

export interface Appointment {
  id: string;
  hospitalId: string;
  departmentId: string;
  patientId: string;
  providerStaffId: string;
  availabilitySessionId: string;
  slotStartsAtUtc: string;
  slotEndsAtUtc: string;
  status: "Booked" | "Cancelled" | "Completed" | "NoShow" | string;
  reason: string | null;
  createdAtUtc: string;
  rescheduledFromAppointmentId: string | null;
}

export interface AppointmentBookInput {
  availabilitySessionId: string;
  patientId: string;
  slotStartsAtUtc: string;
  reason: string | null;
}

export interface AppointmentPage extends Page<Appointment> {}

export interface StaffAssignment {
  id: string;
  hospitalId: string;
  departmentId: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
}

export interface StaffProfile {
  id: string;
  staffCode: string;
  givenName: string;
  middleName: string | null;
  familyName: string | null;
  providerDesignation: string | null;
  isActive: boolean;
  createdAtUtc: string;
  updatedAtUtc: string;
  assignments: StaffAssignment[];
}

export interface QueueEntry {
  id: string;
  hospitalId: string;
  departmentId: string;
  queueDateLocal: string;
  tokenNumber: number;
  status: "Waiting" | "Called" | "InProgress" | "Completed" | "Cancelled" | "NoShow" | string;
  checkedInAtUtc: string;
  calledAtUtc: string | null;
  startedAtUtc: string | null;
  completedAtUtc: string | null;
}

export interface QueuePage extends Page<QueueEntry> {}

export interface BillingServiceItem {
  id:string; hospitalId:string; code:string; name:string; category:string; unitPrice:number; isActive:boolean;
}
export interface InvoiceLine { id:string; serviceCode:string; description:string; quantity:number; unitPrice:number; lineTotal:number; }
export interface BillingInvoice {
  id:string; hospitalId:string; queueEntryId:string; patientId:string; invoiceNumber:string;
  issuedAtUtc:string; status:"Issued"|"PartiallyPaid"|"Paid"|string; subtotal:number; amountPaid:number; balanceDue:number; lines:InvoiceLine[];
}
export interface BillingPayment { id:string; invoiceId:string; receiptNumber:string; amount:number; method:string; reference:string|null; paidAtUtc:string; }
export interface BillingReceipt { receiptNumber:string; invoiceNumber:string; hospitalId:string; patientId:string; amount:number; method:string; reference:string|null; paidAtUtc:string; }
export interface DailyCollectionReport { businessDate:string; timeZoneId:string; totalCollected:number; byMethod:Record<string,number>; paymentCount:number; }
export interface InvoiceLineInput { serviceItemId:string; quantity:number; }

export interface Department { id: string; hospitalId: string; name: string; code: string | null; }
export interface Ward { id: string; departmentId: string; name: string; }
export interface Room { id: string; wardId: string; name: string; }
export interface Bed { id: string; roomId: string; number: string; isActive: boolean; }

export function listBillingServiceItems(baseUrl:string,accessToken:string,tenantId:string,hospitalId:string):Promise<BillingServiceItem[]> {
  return getJson(baseUrl,`/api/v1/hospitals/${encodeURIComponent(hospitalId)}/billing/service-items`,accessToken,tenantId);
}

export function createBillingServiceItem(baseUrl:string,accessToken:string,tenantId:string,hospitalId:string,input:{code:string;name:string;category:string;unitPrice:number;isActive:boolean}):Promise<BillingServiceItem> {
  return postJson(baseUrl,`/api/v1/hospitals/${encodeURIComponent(hospitalId)}/billing/service-items`,accessToken,tenantId,input);
}

export function getInvoiceForVisit(baseUrl:string,accessToken:string,tenantId:string,hospitalId:string,queueEntryId:string):Promise<BillingInvoice> {
  return getJson(baseUrl,`/api/v1/hospitals/${encodeURIComponent(hospitalId)}/billing/visits/${encodeURIComponent(queueEntryId)}/invoice`,accessToken,tenantId);
}

export function createBillingInvoice(baseUrl:string,accessToken:string,tenantId:string,hospitalId:string,input:{queueEntryId:string;lines:InvoiceLineInput[]}):Promise<BillingInvoice> {
  return postJson(baseUrl,`/api/v1/hospitals/${encodeURIComponent(hospitalId)}/billing/invoices`,accessToken,tenantId,input);
}

export function listBillingPayments(baseUrl:string,accessToken:string,tenantId:string,hospitalId:string,invoiceId:string):Promise<BillingPayment[]> {
  return getJson(baseUrl,`/api/v1/hospitals/${encodeURIComponent(hospitalId)}/billing/invoices/${encodeURIComponent(invoiceId)}/payments`,accessToken,tenantId);
}

export function recordBillingPayment(baseUrl:string,accessToken:string,tenantId:string,hospitalId:string,invoiceId:string,input:{amount:number;method:string;reference:string|null}):Promise<BillingPayment> {
  return postJson(baseUrl,`/api/v1/hospitals/${encodeURIComponent(hospitalId)}/billing/invoices/${encodeURIComponent(invoiceId)}/payments`,accessToken,tenantId,input);
}

export function getBillingReceipt(baseUrl:string,accessToken:string,tenantId:string,hospitalId:string,paymentId:string):Promise<BillingReceipt> {
  return getJson(baseUrl,`/api/v1/hospitals/${encodeURIComponent(hospitalId)}/billing/payments/${encodeURIComponent(paymentId)}/receipt`,accessToken,tenantId);
}

export function getDailyCollectionReport(baseUrl:string,accessToken:string,tenantId:string,hospitalId:string,businessDate:string,timeZoneId:string):Promise<DailyCollectionReport> {
  const parameters=new URLSearchParams({businessDate,timeZoneId});
  return getJson(baseUrl,`/api/v1/hospitals/${encodeURIComponent(hospitalId)}/billing/reports/daily-collection?${parameters.toString()}`,accessToken,tenantId);
}

export function listDepartments(baseUrl:string,accessToken:string,tenantId:string,hospitalId:string):Promise<Page<Department>> {
  return getJson(baseUrl,`/api/v1/hospitals/${encodeURIComponent(hospitalId)}/departments?page=1&pageSize=100`,accessToken,tenantId);
}

export function getHospital(baseUrl:string,accessToken:string,tenantId:string,hospitalId:string):Promise<Hospital> {
  return getJson(baseUrl,`/api/v1/hospitals/${encodeURIComponent(hospitalId)}`,accessToken,tenantId);
}
export function updateHospital(baseUrl:string,accessToken:string,tenantId:string,hospitalId:string,input:{name:string;code:string|null}):Promise<Hospital> {
  return putJson(baseUrl,`/api/v1/hospitals/${encodeURIComponent(hospitalId)}`,accessToken,tenantId,input);
}
export function deleteHospital(baseUrl:string,accessToken:string,tenantId:string,hospitalId:string):Promise<void> {
  return deleteJson(baseUrl,`/api/v1/hospitals/${encodeURIComponent(hospitalId)}`,accessToken,tenantId);
}

export function getDepartment(baseUrl:string,accessToken:string,tenantId:string,hospitalId:string,departmentId:string):Promise<Department> {
  return getJson(baseUrl,`/api/v1/hospitals/${encodeURIComponent(hospitalId)}/departments/${encodeURIComponent(departmentId)}`,accessToken,tenantId);
}
export function updateDepartment(baseUrl:string,accessToken:string,tenantId:string,hospitalId:string,departmentId:string,input:{name:string;code:string|null}):Promise<Department> {
  return putJson(baseUrl,`/api/v1/hospitals/${encodeURIComponent(hospitalId)}/departments/${encodeURIComponent(departmentId)}`,accessToken,tenantId,input);
}
export function deleteDepartment(baseUrl:string,accessToken:string,tenantId:string,hospitalId:string,departmentId:string):Promise<void> {
  return deleteJson(baseUrl,`/api/v1/hospitals/${encodeURIComponent(hospitalId)}/departments/${encodeURIComponent(departmentId)}`,accessToken,tenantId);
}

export function listWards(baseUrl:string,accessToken:string,tenantId:string,departmentId:string):Promise<Page<Ward>> {
  return getJson(baseUrl,`/api/v1/departments/${encodeURIComponent(departmentId)}/wards?page=1&pageSize=100`,accessToken,tenantId);
}
export function createWard(baseUrl:string,accessToken:string,tenantId:string,departmentId:string,name:string):Promise<Ward> {
  return postJson(baseUrl,`/api/v1/departments/${encodeURIComponent(departmentId)}/wards`,accessToken,tenantId,{name});
}
export function updateWard(baseUrl:string,accessToken:string,tenantId:string,departmentId:string,wardId:string,name:string):Promise<Ward> {
  return putJson(baseUrl,`/api/v1/departments/${encodeURIComponent(departmentId)}/wards/${encodeURIComponent(wardId)}`,accessToken,tenantId,{name});
}
export function deleteWard(baseUrl:string,accessToken:string,tenantId:string,departmentId:string,wardId:string):Promise<void> {
  return deleteJson(baseUrl,`/api/v1/departments/${encodeURIComponent(departmentId)}/wards/${encodeURIComponent(wardId)}`,accessToken,tenantId);
}

export function listRooms(baseUrl:string,accessToken:string,tenantId:string,wardId:string):Promise<Page<Room>> {
  return getJson(baseUrl,`/api/v1/wards/${encodeURIComponent(wardId)}/rooms?page=1&pageSize=100`,accessToken,tenantId);
}
export function createRoom(baseUrl:string,accessToken:string,tenantId:string,wardId:string,name:string):Promise<Room> {
  return postJson(baseUrl,`/api/v1/wards/${encodeURIComponent(wardId)}/rooms`,accessToken,tenantId,{name});
}
export function updateRoom(baseUrl:string,accessToken:string,tenantId:string,wardId:string,roomId:string,name:string):Promise<Room> {
  return putJson(baseUrl,`/api/v1/wards/${encodeURIComponent(wardId)}/rooms/${encodeURIComponent(roomId)}`,accessToken,tenantId,{name});
}
export function deleteRoom(baseUrl:string,accessToken:string,tenantId:string,wardId:string,roomId:string):Promise<void> {
  return deleteJson(baseUrl,`/api/v1/wards/${encodeURIComponent(wardId)}/rooms/${encodeURIComponent(roomId)}`,accessToken,tenantId);
}

export function listBeds(baseUrl:string,accessToken:string,tenantId:string,roomId:string):Promise<Page<Bed>> {
  return getJson(baseUrl,`/api/v1/rooms/${encodeURIComponent(roomId)}/beds?page=1&pageSize=100`,accessToken,tenantId);
}
export function createBed(baseUrl:string,accessToken:string,tenantId:string,roomId:string,input:{number:string;isActive:boolean}):Promise<Bed> {
  return postJson(baseUrl,`/api/v1/rooms/${encodeURIComponent(roomId)}/beds`,accessToken,tenantId,input);
}
export function updateBed(baseUrl:string,accessToken:string,tenantId:string,roomId:string,bedId:string,input:{number:string;isActive:boolean}):Promise<Bed> {
  return putJson(baseUrl,`/api/v1/rooms/${encodeURIComponent(roomId)}/beds/${encodeURIComponent(bedId)}`,accessToken,tenantId,input);
}
export function deleteBed(baseUrl:string,accessToken:string,tenantId:string,roomId:string,bedId:string):Promise<void> {
  return deleteJson(baseUrl,`/api/v1/rooms/${encodeURIComponent(roomId)}/beds/${encodeURIComponent(bedId)}`,accessToken,tenantId);
}

export function listQueue(baseUrl:string,accessToken:string,tenantId:string,hospitalId:string,departmentId:string,date:string,page=1):Promise<QueuePage> {
  const parameters=new URLSearchParams({departmentId,date,page:String(page),pageSize:"50"});
  return getJson(baseUrl,`/api/v1/hospitals/${encodeURIComponent(hospitalId)}/queue?${parameters.toString()}`,accessToken,tenantId);
}

export interface WalkInCreateInput {
  departmentId: string;
  patientId: string;
  timeZoneId: string;
}


export function createAvailabilitySession(
  baseUrl: string,
  accessToken: string,
  tenantId: string,
  hospitalId: string,
  input: { departmentId: string; providerStaffId: string; localDate: string; startLocalTime: string; endLocalTime: string; slotDurationMinutes: number; timeZoneId: string }
): Promise<AvailabilitySession> {
  return postJson(baseUrl, `/api/v1/hospitals/${encodeURIComponent(hospitalId)}/availability-sessions`, accessToken, tenantId, input);
}

export function listAppointments(
  baseUrl: string,
  accessToken: string,
  tenantId: string,
  hospitalId: string,
  departmentId: string,
  date: string,
  status?: string,
  page = 1
): Promise<AppointmentPage> {
  const parameters = new URLSearchParams({ departmentId, date, page: String(page), pageSize: "25" });
  if (status) parameters.set("status", status);
  return getJson(baseUrl, `/api/v1/hospitals/${encodeURIComponent(hospitalId)}/appointments?${parameters.toString()}`, accessToken, tenantId);
}

export function cancelAppointment(
  baseUrl: string, accessToken: string, tenantId: string, hospitalId: string, appointmentId: string
): Promise<Appointment> {
  return postJson(baseUrl, `/api/v1/hospitals/${encodeURIComponent(hospitalId)}/appointments/${encodeURIComponent(appointmentId)}/cancel`, accessToken, tenantId);
}

export function rescheduleAppointment(
  baseUrl: string, accessToken: string, tenantId: string, hospitalId: string, appointmentId: string, input: AppointmentBookInput
): Promise<Appointment> {
  return postJson(baseUrl, `/api/v1/hospitals/${encodeURIComponent(hospitalId)}/appointments/${encodeURIComponent(appointmentId)}/reschedule`, accessToken, tenantId, input);
}

export function createStaffProfile(
  baseUrl: string, accessToken: string, tenantId: string,
  input: { staffCode: string; givenName: string; middleName: string | null; familyName: string | null; providerDesignation: string | null; hospitalId: string; departmentId: string | null; effectiveFrom: string }
): Promise<StaffProfile> {
  return postJson(baseUrl, "/api/v1/staff/", accessToken, tenantId, input);
}

export function updateStaffProfile(
  baseUrl: string, accessToken: string, tenantId: string, staffId: string,
  input: { givenName: string; middleName: string | null; familyName: string | null; providerDesignation: string | null }
): Promise<StaffProfile> {
  return putJson(baseUrl, `/api/v1/staff/${encodeURIComponent(staffId)}`, accessToken, tenantId, input);
}

export function setStaffProfileActive(
  baseUrl: string, accessToken: string, tenantId: string, staffId: string, isActive: boolean
): Promise<StaffProfile> {
  return postJson(baseUrl, `/api/v1/staff/${encodeURIComponent(staffId)}/${isActive ? "reactivate" : "deactivate"}`, accessToken, tenantId);
}

export function addStaffAssignment(
  baseUrl: string, accessToken: string, tenantId: string, staffId: string,
  input: { hospitalId: string; departmentId: string | null; effectiveFrom: string }
): Promise<StaffAssignment> {
  return postJson(baseUrl, `/api/v1/staff/${encodeURIComponent(staffId)}/assignments`, accessToken, tenantId, input);
}

export function endStaffAssignment(
  baseUrl: string, accessToken: string, tenantId: string, staffId: string, assignmentId: string, effectiveTo: string
): Promise<StaffAssignment> {
  return postJson(baseUrl, `/api/v1/staff/${encodeURIComponent(staffId)}/assignments/${encodeURIComponent(assignmentId)}/end`, accessToken, tenantId, { effectiveTo });
}

export function listStaffProfiles(
  baseUrl: string, accessToken: string, tenantId: string, query?: string, page = 1
): Promise<Page<StaffProfile>> {
  const parameters = new URLSearchParams({ page: String(page), pageSize: "100" });
  if (query) parameters.set("query", query);
  return getJson(baseUrl, `/api/v1/staff?${parameters.toString()}`, accessToken, tenantId);
}

export function listAvailabilitySessions(
  baseUrl: string,
  accessToken: string,
  tenantId: string,
  hospitalId: string,
  date: string,
  departmentId?: string,
  page = 1
): Promise<Page<AvailabilitySession>> {
  const parameters = new URLSearchParams({ date, page: String(page), pageSize: "50" });
  if (departmentId) parameters.set("departmentId", departmentId);
  return getJson(
    baseUrl,
    `/api/v1/hospitals/${encodeURIComponent(hospitalId)}/availability-sessions?${parameters.toString()}`,
    accessToken,
    tenantId
  );
}

export function getAppointmentSlots(
  baseUrl: string,
  accessToken: string,
  tenantId: string,
  hospitalId: string,
  sessionId: string
): Promise<AppointmentSlot[]> {
  return getJson(
    baseUrl,
    `/api/v1/hospitals/${encodeURIComponent(hospitalId)}/availability-sessions/${encodeURIComponent(sessionId)}/slots`,
    accessToken,
    tenantId
  );
}

export function bookAppointment(
  baseUrl: string,
  accessToken: string,
  tenantId: string,
  hospitalId: string,
  input: AppointmentBookInput
): Promise<Appointment> {
  return postJson(
    baseUrl,
    `/api/v1/hospitals/${encodeURIComponent(hospitalId)}/appointments`,
    accessToken,
    tenantId,
    input
  );
}

export function getAppointment(
  baseUrl: string,
  accessToken: string,
  tenantId: string,
  hospitalId: string,
  appointmentId: string
): Promise<Appointment> {
  return getJson(
    baseUrl,
    `/api/v1/hospitals/${encodeURIComponent(hospitalId)}/appointments/${encodeURIComponent(appointmentId)}`,
    accessToken,
    tenantId
  );
}

export function checkInAppointment(
  baseUrl: string,
  accessToken: string,
  tenantId: string,
  hospitalId: string,
  appointmentId: string
): Promise<QueueEntry> {
  return postJson(
    baseUrl,
    `/api/v1/hospitals/${encodeURIComponent(hospitalId)}/appointments/${encodeURIComponent(appointmentId)}/check-in`,
    accessToken,
    tenantId
  );
}

export function createWalkIn(
  baseUrl: string,
  accessToken: string,
  tenantId: string,
  hospitalId: string,
  input: WalkInCreateInput
): Promise<QueueEntry> {
  return postJson(
    baseUrl,
    `/api/v1/hospitals/${encodeURIComponent(hospitalId)}/queue/walk-ins`,
    accessToken,
    tenantId,
    input
  );
}


export type QueueAction = "call" | "recall" | "start" | "complete" | "cancel" | "noshow";
export interface QueueActionInput { reason?: string | null; }

export function transitionQueueEntry(
  baseUrl: string,
  accessToken: string,
  tenantId: string,
  hospitalId: string,
  queueEntryId: string,
  action: QueueAction,
  input: QueueActionInput = {}
): Promise<QueueEntry> {
  return postJson(
    baseUrl,
    `/api/v1/hospitals/${encodeURIComponent(hospitalId)}/queue/${encodeURIComponent(queueEntryId)}/${action}`,
    accessToken,
    tenantId,
    input
  );
}


export type OpdEncounterStatus = "InProgress" | "Signed" | "Closed" | "Cancelled" | string;
export interface OpdEncounterAmendment { id:string; reason:string; content:string; authorIssuer:string; authorSubject:string; createdAtUtc:string; }
export interface OpdEncounter {
  id:string; hospitalId:string; departmentId:string; patientId:string; queueEntryId:string;
  status:OpdEncounterStatus; chiefComplaint:string|null; history:string|null; examination:string|null;
  assessment:string|null; plan:string|null; createdByIssuer:string; createdBySubject:string;
  startedAtUtc:string; signedByIssuer:string|null; signedBySubject:string|null; signedAtUtc:string|null;
  closedAtUtc:string|null; cancellationReason:string|null; amendments:OpdEncounterAmendment[];
}
export interface OpdEncounterNoteInput { chiefComplaint:string|null; history:string|null; examination:string|null; assessment:string|null; plan:string|null; }
export interface OpdEncounterAmendmentInput { reason:string; content:string; }
export interface OpdEncounterCancelInput { reason:string; }

async function deleteJson(baseUrl:string,path:string,accessToken:string,tenantId:string):Promise<void> {
  if(!baseUrl.trim()) throw new Error("The HeapCare API URL is not configured.");
  if(!accessToken.trim()) throw new Error("A valid API access token is not available. Sign in again.");
  if(!tenantId.trim()) throw new Error("Select an active tenant before continuing.");
  const headers=new Headers({Accept:"application/json",Authorization:`Bearer ${accessToken}`,"X-Tenant-ID":tenantId});
  const response=await fetch(endpoint(baseUrl,path),{method:"DELETE",headers,cache:"no-store",credentials:"omit"});
  if(!response.ok) throw new ApiError(response.status);
}

async function putJson<T>(baseUrl:string,path:string,accessToken:string,tenantId:string,body:unknown):Promise<T> {
  if(!baseUrl.trim()) throw new Error("The HeapCare API URL is not configured.");
  if(!accessToken.trim()) throw new Error("A valid API access token is not available. Sign in again.");
  if(!tenantId.trim()) throw new Error("Select an active tenant before continuing.");
  const headers=new Headers({Accept:"application/json",Authorization:`Bearer ${accessToken}`,"X-Tenant-ID":tenantId,"Content-Type":"application/json"});
  const response=await fetch(endpoint(baseUrl,path),{method:"PUT",headers,body:JSON.stringify(body),cache:"no-store",credentials:"omit"});
  if(!response.ok) throw new ApiError(response.status);
  return response.json() as Promise<T>;
}
const opdQueueEncounterPath=(hospitalId:string,queueEntryId:string)=>`/api/v1/hospitals/${encodeURIComponent(hospitalId)}/opd/queue/${encodeURIComponent(queueEntryId)}/encounter`;
const opdEncounterPath=(hospitalId:string,encounterId:string)=>`/api/v1/hospitals/${encodeURIComponent(hospitalId)}/opd/encounters/${encodeURIComponent(encounterId)}`;
export function getOpdEncounterForQueue(baseUrl:string,accessToken:string,tenantId:string,hospitalId:string,queueEntryId:string):Promise<OpdEncounter>{
  return getJson(baseUrl,opdQueueEncounterPath(hospitalId,queueEntryId),accessToken,tenantId);
}
export function createOpdEncounterFromQueue(baseUrl:string,accessToken:string,tenantId:string,hospitalId:string,queueEntryId:string):Promise<OpdEncounter>{
  return postJson(baseUrl,opdQueueEncounterPath(hospitalId,queueEntryId),accessToken,tenantId);
}
export function getOpdEncounter(baseUrl:string,accessToken:string,tenantId:string,hospitalId:string,encounterId:string):Promise<OpdEncounter>{
  return getJson(baseUrl,opdEncounterPath(hospitalId,encounterId),accessToken,tenantId);
}
export function updateOpdEncounterNote(baseUrl:string,accessToken:string,tenantId:string,hospitalId:string,encounterId:string,input:OpdEncounterNoteInput):Promise<OpdEncounter>{
  return putJson(baseUrl,`${opdEncounterPath(hospitalId,encounterId)}/note`,accessToken,tenantId,input);
}
export function signOpdEncounter(baseUrl:string,accessToken:string,tenantId:string,hospitalId:string,encounterId:string):Promise<OpdEncounter>{
  return postJson(baseUrl,`${opdEncounterPath(hospitalId,encounterId)}/sign`,accessToken,tenantId);
}
export function addOpdEncounterAmendment(baseUrl:string,accessToken:string,tenantId:string,hospitalId:string,encounterId:string,input:OpdEncounterAmendmentInput):Promise<OpdEncounter>{
  return postJson(baseUrl,`${opdEncounterPath(hospitalId,encounterId)}/amendments`,accessToken,tenantId,input);
}
export function closeOpdEncounter(baseUrl:string,accessToken:string,tenantId:string,hospitalId:string,encounterId:string):Promise<OpdEncounter>{
  return postJson(baseUrl,`${opdEncounterPath(hospitalId,encounterId)}/close`,accessToken,tenantId);
}
export function cancelOpdEncounter(baseUrl:string,accessToken:string,tenantId:string,hospitalId:string,encounterId:string,input:OpdEncounterCancelInput):Promise<OpdEncounter>{
  return postJson(baseUrl,`${opdEncounterPath(hospitalId,encounterId)}/cancel`,accessToken,tenantId,input);
}


export function getDepartmentPatient(
  baseUrl:string,accessToken:string,tenantId:string,hospitalId:string,departmentId:string,patientId:string
):Promise<Patient>{
  return getJson(
    baseUrl,
    `/api/v1/hospitals/${encodeURIComponent(hospitalId)}/patients/departments/${encodeURIComponent(departmentId)}/patients/${encodeURIComponent(patientId)}`,
    accessToken,
    tenantId
  );
}


export function getHospitalPatient(
  baseUrl:string,accessToken:string,tenantId:string,hospitalId:string,patientId:string
):Promise<Patient>{
  return getJson(
    baseUrl,
    `/api/v1/hospitals/${encodeURIComponent(hospitalId)}/patients/${encodeURIComponent(patientId)}`,
    accessToken,
    tenantId
  );
}


export interface PlatformOperatorStatus {
  isPlatformOperator: boolean;
}

export interface PlatformTenant {
  id: string;
  name: string;
  slug: string;
  status: "Provisioning" | "Active" | "Suspended" | "Closed" | string;
  createdAtUtc: string;
  updatedAtUtc: string;
}

async function postPlatformJson<T>(baseUrl: string, path: string, accessToken: string, body: unknown): Promise<T> {
  if (!baseUrl.trim()) throw new Error("The HeapCare API URL is not configured.");
  if (!accessToken.trim()) throw new Error("A valid API access token is not available. Sign in again.");
  const response = await fetch(endpoint(baseUrl, path), {
    method: "POST",
    headers: new Headers({
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    }),
    body: JSON.stringify(body),
    cache: "no-store",
    credentials: "omit"
  });
  if (!response.ok) throw new ApiError(response.status);
  return response.json() as Promise<T>;
}

export function getPlatformOperatorStatus(baseUrl: string, accessToken: string): Promise<PlatformOperatorStatus> {
  return getJson(baseUrl, "/api/v1/platform/operator/status", accessToken);
}

export function listPlatformTenants(baseUrl: string, accessToken: string, page = 1): Promise<Page<PlatformTenant>> {
  const parameters = new URLSearchParams({ page: String(page), pageSize: "50" });
  return getJson(baseUrl, `/api/v1/platform/tenants?${parameters.toString()}`, accessToken);
}

export function bootstrapPlatformOperator(baseUrl: string, accessToken: string, bootstrapSecret: string): Promise<{status:string}> {
  return postPlatformJson(baseUrl, "/api/v1/platform/bootstrap/operator", accessToken, { bootstrapSecret });
}

export function createPlatformTenant(baseUrl: string, accessToken: string, name: string, slug: string): Promise<PlatformTenant> {
  return postPlatformJson(baseUrl, "/api/v1/platform/tenants", accessToken, { name, slug });
}

export function provisionInitialTenantAdministrator(baseUrl: string, accessToken: string, tenantId: string, issuer: string, subject: string): Promise<unknown> {
  return postPlatformJson(baseUrl, `/api/v1/platform/tenants/${encodeURIComponent(tenantId)}/initial-administrator`, accessToken, { issuer, subject });
}

export function activatePlatformTenant(baseUrl: string, accessToken: string, tenantId: string): Promise<PlatformTenant> {
  return postPlatformJson(baseUrl, `/api/v1/platform/tenants/${encodeURIComponent(tenantId)}/activate`, accessToken, {});
}

export function suspendPlatformTenant(baseUrl: string, accessToken: string, tenantId: string): Promise<PlatformTenant> {
  return postPlatformJson(baseUrl, `/api/v1/platform/tenants/${encodeURIComponent(tenantId)}/suspend`, accessToken, {});
}

export function closePlatformTenant(baseUrl: string, accessToken: string, tenantId: string): Promise<PlatformTenant> {
  return postPlatformJson(baseUrl, `/api/v1/platform/tenants/${encodeURIComponent(tenantId)}/close`, accessToken, {});
}

export function createHospital(baseUrl: string, accessToken: string, tenantId: string, name: string, code: string | null): Promise<Hospital> {
  return postJson(baseUrl, "/api/v1/hospitals", accessToken, tenantId, { name, code });
}

export function createDepartment(baseUrl: string, accessToken: string, tenantId: string, hospitalId: string, name: string, code: string | null): Promise<Department> {
  return postJson(baseUrl, `/api/v1/hospitals/${encodeURIComponent(hospitalId)}/departments`, accessToken, tenantId, { name, code });
}
