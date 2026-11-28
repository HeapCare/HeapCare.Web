import { useEffect,useState } from "react";
import type { FormEvent } from "react";
import { Link,Route,Routes,useLocation,useNavigate } from "react-router-dom";
import type { User } from "oidc-client-ts";
import { isAuthenticationConfigured,userManager } from "../auth/oidc";
import { BillingWorkspace } from "../features/billing/BillingWorkspace";
import { ReceptionWorkspace } from "../features/reception/ReceptionWorkspace";
import { PatientRegistrationWorkspace } from "../features/reception/PatientRegistrationWorkspace";
import { AppointmentBookingWorkspace } from "../features/appointments/AppointmentBookingWorkspace";
import { AppointmentManagement } from "../features/appointments/AppointmentManagement";
import { StaffManagement } from "../features/staff/StaffManagement";
import { HospitalOverview } from "../features/overview/HospitalOverview";
import { QueueWorkspace } from "../features/queue/QueueWorkspace";
import { ClinicalQueueRow } from "../features/clinical/ClinicalQueueRow";
import { FacilityManagement } from "../features/facilities/FacilityManagement";
import { PatientIdentifierPolicyManagement } from "../features/reception/PatientIdentifierPolicyManagement";
import { TenantMembershipManagement } from "../features/memberships/TenantMembershipManagement";
import { TenantRoleManagement } from "../features/memberships/TenantRoleManagement";
import { PlatformTenantManagement } from "../features/platform/PlatformTenantManagement";
import { readWorkspaceSelection, resolveHospitalSelection, resolveTenantSelection, writeWorkspaceSelection, WORKSPACE_TENANT_SELECTION_KEY, workspaceHospitalSelectionKey } from "./workspaceSelection";
import { getCanonicalWorkspaceLocation, getRequestedWorkspaceSection, isWorkspaceModuleSection } from "./workspaceRoutes";
import {
  ApiError,
  getCurrentUserTenantContexts,
  getPlatformOperatorStatus,
  getHospitals,
  searchPatients,
  findPatientByMrn,
  checkPatientDuplicateCandidates,
  registerPatient,
  assignPatientMedicalRecordNumber,
  listDepartments,
  listAvailabilitySessions,
  getAppointmentSlots,
  bookAppointment,
  checkInAppointment,
  createWalkIn,
  listQueue,
  transitionQueueEntry,
  getOpdEncounterForQueue,
  getDepartmentPatient,
  createOpdEncounterFromQueue,
  updateOpdEncounterNote,
  signOpdEncounter,
  addOpdEncounterAmendment,
  closeOpdEncounter,
  cancelOpdEncounter,
  bootstrapPlatformOperator,
  createPlatformTenant,
  provisionInitialTenantAdministrator,
  activatePlatformTenant,
  createHospital,
  createDepartment,
  type OpdEncounter,
  type OpdEncounterNoteInput,
  type PatientRegistrationInput,
  type PatientDuplicateCheck,
  type Hospital,
  type Patient,
  type UserTenantContext,
  type Department,
  type AvailabilitySession,
  type AppointmentSlot,
  type Appointment,
  type QueueEntry,
  type QueueAction
} from "../api/heapcare";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL as string | undefined;
const localPlatformBootstrapEnabled = import.meta.env.VITE_ENABLE_PLATFORM_BOOTSTRAP === "true";
const localDateToday = () => { const d=new Date(); return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-"); };

function Callback() {
  const navigate = useNavigate();
  const [error,setError] = useState("");

  useEffect(() => {
    const manager = userManager;
    if (!manager) { setError("Authentication is not configured."); return; }
    let active = true;
    manager.signinCallback()
      .then(() => { if (active) navigate("/",{replace:true}); })
      .catch(() => { if (active) setError("Sign-in could not be completed. Return to the workspace and try again."); });
    return () => { active = false; };
  },[navigate]);

  return <main className="callback" role="status">{error || "Completing secure sign-in…"}</main>;
}

function SilentCallback() {
  const [error,setError] = useState("");
  useEffect(() => {
    const manager = userManager;
    if (!manager) { setError("Authentication is not configured."); return; }
    manager.signinSilentCallback()
      .catch(() => setError("Session renewal could not be completed. Sign in again."));
  },[]);
  return <main className="callback" role="status">{error || "Renewing secure session…"}</main>;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "The request could not be completed. Try again.";
}

function patientName(patient: Patient): string {
  return [patient.givenName,patient.middleName,patient.familyName].filter(Boolean).join(" ");
}


function ClinicalWorkspace({baseUrl,accessToken,tenantId,hospitalId,departments,permissions,onBusyChange}:{baseUrl:string;accessToken:string;tenantId:string;hospitalId:string;departments:Department[];permissions:string[];onBusyChange:(busy:boolean)=>void}) {
  const [departmentId,setDepartmentId]=useState("");
  const [queueDate,setQueueDate]=useState(localDateToday());
  const [queue,setQueue]=useState<QueueEntry[]>([]);
  const [loadingQueue,setLoadingQueue]=useState(false);
  const [queueError,setQueueError]=useState("");
  const [encounter,setEncounter]=useState<OpdEncounter|null>(null);
  const [clinicalPatient,setClinicalPatient]=useState<Patient|null>(null);
  const [identityConfirmed,setIdentityConfirmed]=useState(false);
  const [openingId,setOpeningId]=useState("");
  const [actionBusy,setActionBusy]=useState(false);
  const [actionError,setActionError]=useState("");
  const [actionSuccess,setActionSuccess]=useState("");
  const [chiefComplaint,setChiefComplaint]=useState("");
  const [history,setHistory]=useState("");
  const [examination,setExamination]=useState("");
  const [assessment,setAssessment]=useState("");
  const [plan,setPlan]=useState("");
  const [cancelReason,setCancelReason]=useState("");
  const [amendmentReason,setAmendmentReason]=useState("");
  const [amendmentContent,setAmendmentContent]=useState("");

  useEffect(()=>{setDepartmentId(current=>departments.some(x=>x.id===current)?current:departments.length===1?departments[0].id:"");},[departments]);
  const clinicalQueue=queue.filter(x=>x.status==="InProgress"||x.status==="Completed");
  const canManageEncounter=permissions.includes("encounter.manage");
  const canSignEncounter=permissions.includes("encounter.sign");
  const canAmendEncounter=permissions.includes("encounter.amend");
  const editable=encounter?.status==="InProgress"&&identityConfirmed&&canManageEncounter;
  const setBusy=(busy:boolean)=>{setActionBusy(busy);onBusyChange(busy);};
  function applyEncounter(value:OpdEncounter,patientValue:Patient|null=clinicalPatient,resetIdentity=false){
    setEncounter(value);setClinicalPatient(patientValue);if(resetIdentity)setIdentityConfirmed(false);setChiefComplaint(value.chiefComplaint??"");setHistory(value.history??"");
    setExamination(value.examination??"");setAssessment(value.assessment??"");setPlan(value.plan??"");
    setCancelReason("");setActionError("");setActionSuccess("");
  }
  async function refreshQueue(){
    setLoadingQueue(true);setQueueError("");setEncounter(null);setClinicalPatient(null);setIdentityConfirmed(false);
    try{const result=await listQueue(baseUrl,accessToken,tenantId,hospitalId,departmentId,queueDate);setQueue(result.items);}
    catch(error){setQueue([]);setQueueError(getErrorMessage(error));}
    finally{setLoadingQueue(false);}
  }
  async function openEncounter(entry:QueueEntry){
    setOpeningId(entry.id);setBusy(true);setActionError("");setActionSuccess("");
    try{
      let value:OpdEncounter;
      try{value=await getOpdEncounterForQueue(baseUrl,accessToken,tenantId,hospitalId,entry.id);}
      catch(error){
        if(!(error instanceof ApiError)||error.status!==404)throw error;
        if(entry.status!=="InProgress"||!canManageEncounter)throw error;
        try{value=await createOpdEncounterFromQueue(baseUrl,accessToken,tenantId,hospitalId,entry.id);}
        catch(createError){
          if(!(createError instanceof ApiError)||createError.status!==409)throw createError;
          try{value=await getOpdEncounterForQueue(baseUrl,accessToken,tenantId,hospitalId,entry.id);}
          catch(resumeError){if(resumeError instanceof ApiError&&resumeError.status===404)throw createError;throw resumeError;}
        }
      }
      const verifiedPatient=await getDepartmentPatient(baseUrl,accessToken,tenantId,hospitalId,entry.departmentId,value.patientId);
      applyEncounter(value,verifiedPatient,true);
    }catch(error){setActionError(getErrorMessage(error));}
    finally{setOpeningId("");setBusy(false);}
  }
  function noteInput():OpdEncounterNoteInput{
    return {chiefComplaint:chiefComplaint.trim()||null,history:history.trim()||null,examination:examination.trim()||null,assessment:assessment.trim()||null,plan:plan.trim()||null};
  }
  async function saveDraft(){
    if(!encounter||!editable)return;
    setBusy(true);setActionError("");setActionSuccess("");
    try{applyEncounter(await updateOpdEncounterNote(baseUrl,accessToken,tenantId,hospitalId,encounter.id,noteInput()));setActionSuccess("Draft note saved.");}
    catch(error){setActionError(getErrorMessage(error));}
    finally{setBusy(false);}
  }
  async function signEncounter(){
    if(!encounter||!editable)return;
    if(!chiefComplaint.trim()||!assessment.trim()){setActionError("Chief complaint and assessment are required before signing.");return;}
    setBusy(true);setActionError("");setActionSuccess("");
    try{
      const saved=await updateOpdEncounterNote(baseUrl,accessToken,tenantId,hospitalId,encounter.id,noteInput());
      const signed=await signOpdEncounter(baseUrl,accessToken,tenantId,hospitalId,saved.id);
      applyEncounter(signed);setActionSuccess("Encounter signed. The original note is now read-only.");
    }catch(error){setActionError(getErrorMessage(error));}
    finally{setBusy(false);}
  }
  async function closeEncounter(){
    if(!encounter||encounter.status!=="Signed")return;
    setBusy(true);setActionError("");setActionSuccess("");
    try{applyEncounter(await closeOpdEncounter(baseUrl,accessToken,tenantId,hospitalId,encounter.id));setActionSuccess("Encounter closed.");}
    catch(error){setActionError(getErrorMessage(error));}
    finally{setBusy(false);}
  }
  async function cancelEncounter(){
    if(!encounter||!editable)return;
    if(!cancelReason.trim()){setActionError("A cancellation reason is required.");return;}
    setBusy(true);setActionError("");setActionSuccess("");
    try{applyEncounter(await cancelOpdEncounter(baseUrl,accessToken,tenantId,hospitalId,encounter.id,{reason:cancelReason.trim()}));setActionSuccess("Unsigned encounter cancelled.");}
    catch(error){setActionError(getErrorMessage(error));}
    finally{setBusy(false);}
  }
  async function addAmendment(){
    if(!encounter||!(encounter.status==="Signed"||encounter.status==="Closed"))return;
    if(!amendmentReason.trim()||!amendmentContent.trim()){setActionError("Both amendment reason and content are required.");return;}
    setBusy(true);setActionError("");setActionSuccess("");
    try{
      applyEncounter(await addOpdEncounterAmendment(baseUrl,accessToken,tenantId,hospitalId,encounter.id,{reason:amendmentReason.trim(),content:amendmentContent.trim()}));
      setAmendmentReason("");setAmendmentContent("");setActionSuccess("Append-only amendment added.");
    }catch(error){setActionError(getErrorMessage(error));}
    finally{setBusy(false);}
  }
  return <section className="section clinical-section" id="clinical">
    <div className="section-heading"><div><label>CLINICAL WORKSPACE</label><h2>Outpatient consultations</h2><p className="helper-text">Clinical records are separate from queue operations. Only authorized ClinicalUser memberships can access this workspace.</p></div></div>
    <div className="search-panel clinical-panel">
      <div className="appointment-grid">
        <div><label htmlFor="clinical-department">Department</label><select id="clinical-department" value={departmentId} onChange={e=>{setDepartmentId(e.target.value);setQueue([]);setEncounter(null);}} disabled={actionBusy||loadingQueue}><option value="">Select department</option>{departments.map(d=><option key={d.id} value={d.id}>{d.name}{d.code?" · "+d.code:""}</option>)}</select></div>
        <div><label htmlFor="clinical-queue-date">Queue date</label><input id="clinical-queue-date" type="date" value={queueDate} onChange={e=>{setQueueDate(e.target.value);setQueue([]);setEncounter(null);}} disabled={actionBusy||loadingQueue}/></div>
      </div>
      <div className="registration-actions"><button type="button" onClick={refreshQueue} disabled={!departmentId||loadingQueue||actionBusy}>{loadingQueue?"Loading clinical queue…":"Refresh clinical queue"}</button></div>
      <p className="helper-text">The queue view contains operational tokens only. Patient identity and clinical details are not exposed in queue rows.</p>
      {queueError&&<p className="inline-error" role="alert">{queueError}</p>}
      {queue.length>0?<div className="clinical-queue" aria-label="Clinical queue and recent completed visits">
        {clinicalQueue.map(entry=><ClinicalQueueRow
          key={entry.id}
          entry={entry}
          opening={openingId===entry.id}
          disabled={actionBusy||loadingQueue}
          onOpen={openEncounter}
        />)}
        {clinicalQueue.length===0&&<p className="inline-status">No in-progress consultations or completed visits are available for this department and date.</p>}
      </div>:!loadingQueue&&!queueError&&<p className="inline-status">Refresh the clinical queue to see in-progress consultations and completed visits.</p>}
    </div>
    {encounter&&<div className="search-panel encounter-panel">
      <div className="encounter-heading"><div><label>ENCOUNTER RECORD</label><h3>Consultation note</h3><p className="helper-text">Started {new Date(encounter.startedAtUtc).toLocaleString()}</p></div><span className={"queue-status queue-status-"+encounter.status.toLowerCase()}>{encounter.status}</span></div>
      {clinicalPatient&&<div className="clinical-patient-banner"><div><small>HOSPITAL REGISTRATION</small><strong>{patientName(clinicalPatient)}</strong><span>{clinicalPatient.dateOfBirth?"Date of birth: "+clinicalPatient.dateOfBirth:"Date of birth not recorded"}</span></div><span>Patient identity loaded from the selected hospital</span><label className="clinical-identity-confirm"><input type="checkbox" checked={identityConfirmed} onChange={e=>setIdentityConfirmed(e.target.checked)} disabled={actionBusy}/> I have verified the patient identity before documenting</label></div>}
      <p className="helper-text">Patient identity is retrieved through the hospital-scoped patient API. Do not copy clinical note text into general logs, URLs or support messages.</p>
      {!identityConfirmed&&<p className="inline-status" role="status">Verify the patient identity above to view or edit this encounter note.</p>}
      {identityConfirmed&&<>
      <div className="clinical-note-grid">
        <div><label htmlFor="clinical-chief">Chief complaint *</label><textarea id="clinical-chief" rows={3} maxLength={500} value={chiefComplaint} onChange={e=>setChiefComplaint(e.target.value)} disabled={!editable||actionBusy}/><small>{chiefComplaint.length}/500</small></div>
        <div><label htmlFor="clinical-history">History</label><textarea id="clinical-history" rows={4} maxLength={4000} value={history} onChange={e=>setHistory(e.target.value)} disabled={!editable||actionBusy}/><small>{history.length}/4000</small></div>
        <div><label htmlFor="clinical-examination">Examination</label><textarea id="clinical-examination" rows={4} maxLength={4000} value={examination} onChange={e=>setExamination(e.target.value)} disabled={!editable||actionBusy}/><small>{examination.length}/4000</small></div>
        <div><label htmlFor="clinical-assessment">Assessment *</label><textarea id="clinical-assessment" rows={3} maxLength={2000} value={assessment} onChange={e=>setAssessment(e.target.value)} disabled={!editable||actionBusy}/><small>{assessment.length}/2000</small></div>
        <div className="clinical-plan"><label htmlFor="clinical-plan">Plan</label><textarea id="clinical-plan" rows={4} maxLength={4000} value={plan} onChange={e=>setPlan(e.target.value)} disabled={!editable||actionBusy}/><small>{plan.length}/4000</small></div>
      </div>
      {editable&&<div className="clinical-actions">{canManageEncounter&&<button type="button" className="clinical-secondary" onClick={saveDraft} disabled={actionBusy}>{actionBusy?"Saving…":"Save draft"}</button>}{canSignEncounter&&<button type="button" onClick={signEncounter} disabled={actionBusy||!chiefComplaint.trim()||!assessment.trim()}>Review and sign</button>}</div>}
      {editable&&<div className="clinical-cancel"><label htmlFor="clinical-cancel-reason">Cancellation reason (required to cancel an unsigned encounter)</label><input id="clinical-cancel-reason" value={cancelReason} maxLength={250} onChange={e=>setCancelReason(e.target.value)} disabled={actionBusy}/><button type="button" className="queue-action-danger" onClick={cancelEncounter} disabled={actionBusy||!cancelReason.trim()}>Cancel encounter</button></div>}
      {encounter.status==="Signed"&&canManageEncounter&&<div className="clinical-actions"><button type="button" onClick={closeEncounter} disabled={actionBusy}>{actionBusy?"Closing…":"Close encounter"}</button></div>}
      {(encounter.status==="Signed"||encounter.status==="Closed")&&<div className="amendment-panel">
        <h4>Amendment history</h4>
        {encounter.amendments.length>0?encounter.amendments.map(item=><article className="amendment-item" key={item.id}><strong>{item.reason}</strong><p>{item.content}</p><small>Added {new Date(item.createdAtUtc).toLocaleString()}</small></article>):<p className="inline-status">No amendments have been added.</p>}
        {canAmendEncounter&&<><label htmlFor="amendment-reason">Amendment reason</label><input id="amendment-reason" value={amendmentReason} maxLength={250} onChange={e=>setAmendmentReason(e.target.value)} disabled={actionBusy}/>
        <label htmlFor="amendment-content">Addendum / correction</label><textarea id="amendment-content" rows={3} maxLength={4000} value={amendmentContent} onChange={e=>setAmendmentContent(e.target.value)} disabled={actionBusy}/>
        <button type="button" onClick={addAmendment} disabled={actionBusy||!amendmentReason.trim()||!amendmentContent.trim()}>Add append-only amendment</button></>}
      </div>}
      </>}
      {actionError&&<p className="inline-error" role="alert">{actionError}</p>}
      {actionSuccess&&<p className="registration-success" role="status">{actionSuccess}</p>}
    </div>}
  </section>;
}


function PlatformOnboarding({user,onComplete}:{user:User;onComplete:()=>Promise<void>}) {
  const [secret,setSecret]=useState("");
  const [tenantName,setTenantName]=useState("");
  const [tenantSlug,setTenantSlug]=useState("");
  const [hospitalName,setHospitalName]=useState("");
  const [hospitalCode,setHospitalCode]=useState("");
  const [departmentName,setDepartmentName]=useState("General Medicine");
  const [departmentCode,setDepartmentCode]=useState("GEN");
  const [tenantId,setTenantId]=useState("");
  const [hospitalId,setHospitalId]=useState("");
  const [step,setStep]=useState(0);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const authority=import.meta.env.VITE_OIDC_AUTHORITY as string|undefined;

  async function run(action:()=>Promise<void>) {
    setBusy(true);setError("");setMessage("");
    try{await action();}catch(e){setError(getErrorMessage(e));}
    finally{setBusy(false);}
  }
  const accessToken=user.access_token;
  const subject=String(user.profile.sub??"");

  return <section className="section onboarding-section">
    <div className="section-heading"><div><label>FIRST-TIME SETUP</label><h2>Set up your hospital organization</h2><p className="helper-text">This guided local setup uses the authenticated identity and protected HeapCare provisioning APIs. No database records are inserted directly.</p></div></div>
    <div className="search-panel">
      <h3>Step 1 · Register the first platform operator</h3>
      <p className="helper-text">Enter the one-time secret configured as PLATFORM_BOOTSTRAP_SECRET in HeapCare.Local/local/.env. This endpoint is available only in Development and only once.</p>
      <label htmlFor="platform-bootstrap-secret">One-time local bootstrap secret</label>
      <input id="platform-bootstrap-secret" type="password" autoComplete="off" value={secret} onChange={e=>setSecret(e.target.value)} disabled={step>0||busy}/>
      <button type="button" onClick={()=>run(async()=>{
        if(!secret.trim())throw new Error("Enter the local bootstrap secret.");
        try {
          await bootstrapPlatformOperator(apiBaseUrl??"",accessToken,secret);
          setMessage("Platform operator provisioned for the signed-in identity.");
        } catch (e) {
          if (e instanceof ApiError && e.status === 409) {
            setMessage("Platform bootstrap was already completed. The next step will verify whether this identity is an authorized platform operator.");
          } else {
            throw e;
          }
        }
        setStep(1);
      })} disabled={step>0||busy||!secret.trim()}> {busy?"Working…":"Bootstrap platform operator"} </button>
      <div className="divider"/>
      <h3>Step 2 · Create the hospital tenant</h3>
      <div className="registration-grid">
        <div><label htmlFor="onboarding-tenant-name">Tenant / hospital group name</label><input id="onboarding-tenant-name" value={tenantName} onChange={e=>setTenantName(e.target.value)} disabled={step>1||busy}/></div>
        <div><label htmlFor="onboarding-tenant-slug">Unique tenant slug</label><input id="onboarding-tenant-slug" value={tenantSlug} onChange={e=>setTenantSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,""))} placeholder="example-hospital-group" disabled={step>1||busy}/></div>
      </div>
      <button type="button" onClick={()=>run(async()=>{
        if(step<1)throw new Error("Complete platform operator bootstrap first.");
        const tenant=await createPlatformTenant(apiBaseUrl??"",accessToken,tenantName.trim(),tenantSlug.trim());
        setTenantId(tenant.id);setStep(2);setMessage(`Tenant created in ${tenant.status} state: ${tenant.name}.`);
      })} disabled={step!==1||busy||!tenantName.trim()||!tenantSlug.trim()}>Create tenant</button>
      <div className="divider"/>
      <h3>Step 3 · Assign yourself as the initial tenant administrator</h3>
      <p className="helper-text">The membership is bound to the validated OIDC issuer and subject of this sign-in. The tenant is activated only after initial administrator provisioning succeeds.</p>
      <button type="button" onClick={()=>run(async()=>{
        if(!tenantId||!authority||!subject)throw new Error("Tenant or validated OIDC identity is missing.");
        await provisionInitialTenantAdministrator(apiBaseUrl??"",accessToken,tenantId,authority,subject);
        await activatePlatformTenant(apiBaseUrl??"",accessToken,tenantId);
        setStep(3);setMessage("Initial HospitalAdmin membership created and tenant activated.");
      })} disabled={step!==2||busy}>Provision initial administrator and activate tenant</button>
      <div className="divider"/>
      <h3>Step 4 · Register the first hospital and department</h3>
      <div className="registration-grid">
        <div><label htmlFor="onboarding-hospital-name">Hospital name</label><input id="onboarding-hospital-name" value={hospitalName} onChange={e=>setHospitalName(e.target.value)} disabled={step>3||busy}/></div>
        <div><label htmlFor="onboarding-hospital-code">Hospital code (optional)</label><input id="onboarding-hospital-code" value={hospitalCode} onChange={e=>setHospitalCode(e.target.value)} disabled={step>3||busy}/></div>
        <div><label htmlFor="onboarding-department-name">First department</label><input id="onboarding-department-name" value={departmentName} onChange={e=>setDepartmentName(e.target.value)} disabled={step>3||busy}/></div>
        <div><label htmlFor="onboarding-department-code">Department code (optional)</label><input id="onboarding-department-code" value={departmentCode} onChange={e=>setDepartmentCode(e.target.value)} disabled={step>3||busy}/></div>
      </div>
      <button type="button" onClick={()=>run(async()=>{
        if(!tenantId||step!==3)throw new Error("Complete tenant activation first.");
        const hospital=await createHospital(apiBaseUrl??"",accessToken,tenantId,hospitalName.trim(),hospitalCode.trim()||null);
        setHospitalId(hospital.id);
        await createDepartment(apiBaseUrl??"",accessToken,tenantId,hospital.id,departmentName.trim(),departmentCode.trim()||null);
        setStep(4);setMessage(`Hospital ${hospital.name} and its first department were created.`);
        await onComplete();
      })} disabled={step!==3||busy||!hospitalName.trim()||!departmentName.trim()}>Create hospital and department</button>
      {error&&<p className="inline-error" role="alert">{error}</p>}
      {message&&<p className="registration-success" role="status">{message}</p>}
      {step===4&&<p className="inline-status">Setup complete. Your active hospital context is being loaded.</p>}
      <small className="helper-text">Tenant ID: {tenantId||"Not created"} · Hospital ID: {hospitalId||"Not created"}</small>
    </div>
  </section>;
}

function Workspace() {
  const location = useLocation();
  const navigate = useNavigate();
  const [user,setUser] = useState<User|null>(null);
  const [sessionLoading,setSessionLoading] = useState(true);
  const [authError,setAuthError] = useState("");
  const [contexts,setContexts] = useState<UserTenantContext[]>([]);
  const [contextsLoading,setContextsLoading] = useState(false);
  const [contextsResolved,setContextsResolved] = useState(false);
  const [contextsError,setContextsError] = useState("");
  const [isPlatformOperator,setIsPlatformOperator] = useState(false);
  const [platformOperatorLoading,setPlatformOperatorLoading] = useState(false);
  const [platformOperatorResolved,setPlatformOperatorResolved] = useState(false);
  const [platformOperatorError,setPlatformOperatorError] = useState("");
  const [selectedTenantId,setSelectedTenantId] = useState("");
  const [hospitals,setHospitals] = useState<Hospital[]>([]);
  const [hospitalsLoading,setHospitalsLoading] = useState(false);
  const [hospitalsError,setHospitalsError] = useState("");
  const [selectedHospitalId,setSelectedHospitalId] = useState("");
  const [patientQuery,setPatientQuery] = useState("");
  const [patientSearchMode,setPatientSearchMode] = useState<"name"|"mrn">("name");
  const [patients,setPatients] = useState<Patient[]>([]);
  const [patientTotal,setPatientTotal] = useState(0);
  const [patientPage,setPatientPage] = useState(1);
  const [patientTotalPages,setPatientTotalPages] = useState(0);
  const [searchLoading,setSearchLoading] = useState(false);
  const [searchError,setSearchError] = useState("");
  const [hasSearched,setHasSearched] = useState(false);
  const [registrationGivenName,setRegistrationGivenName] = useState("");
  const [registrationMiddleName,setRegistrationMiddleName] = useState("");
  const [registrationFamilyName,setRegistrationFamilyName] = useState("");
  const [registrationDob,setRegistrationDob] = useState("");
  const [duplicateCheck,setDuplicateCheck] = useState<PatientDuplicateCheck|null>(null);
  const [duplicateLoading,setDuplicateLoading] = useState(false);
  const [duplicateError,setDuplicateError] = useState("");
  const [duplicateAcknowledged,setDuplicateAcknowledged] = useState(false);
  const [registrationLoading,setRegistrationLoading] = useState(false);
  const [registrationError,setRegistrationError] = useState("");

  const [registrationSuccess,setRegistrationSuccess] = useState("");
  const [departments,setDepartments] = useState<Department[]>([]);
  const [departmentsLoading,setDepartmentsLoading] = useState(false);
  const [departmentsError,setDepartmentsError] = useState("");
  const [selectedDepartmentId,setSelectedDepartmentId] = useState("");
  const [selectedPatient,setSelectedPatient] = useState<Patient|null>(null);
  const [appointmentDate,setAppointmentDate] = useState(localDateToday());
  const [availabilitySessions,setAvailabilitySessions] = useState<AvailabilitySession[]>([]);
  const [availabilityLoading,setAvailabilityLoading] = useState(false);
  const [availabilityError,setAvailabilityError] = useState("");
  const [selectedSessionId,setSelectedSessionId] = useState("");
  const [slots,setSlots] = useState<AppointmentSlot[]>([]);
  const [slotsLoading,setSlotsLoading] = useState(false);
  const [selectedSlotStart,setSelectedSlotStart] = useState("");
  const [appointmentReason,setAppointmentReason] = useState("");
  const [bookingLoading,setBookingLoading] = useState(false);
  const [bookingError,setBookingError] = useState("");
  const [bookedAppointment,setBookedAppointment] = useState<Appointment|null>(null);
  const [checkInLoading,setCheckInLoading] = useState(false);
  const [checkInError,setCheckInError] = useState("");
  const [queueEntry,setQueueEntry] = useState<QueueEntry|null>(null);
  const [walkInLoading,setWalkInLoading] = useState(false);
  const [walkInError,setWalkInError] = useState("");
  const [queueEntries,setQueueEntries] = useState<QueueEntry[]>([]);
  const [queueLoading,setQueueLoading] = useState(false);
  const [queueError,setQueueError] = useState("");
  const [queueActionError,setQueueActionError] = useState("");
  const [queueActionLoadingId,setQueueActionLoadingId] = useState("");
  const [queueActionReason,setQueueActionReason] = useState("");
  const [queueDate,setQueueDate] = useState(localDateToday());
  const [hospitalTimeZone,setHospitalTimeZone] = useState("Asia/Kolkata");
  const [clinicalBusy,setClinicalBusy] = useState(false);
  const [facilityBusy,setFacilityBusy] = useState(false);
  const [appointmentManagementBusy,setAppointmentManagementBusy] = useState(false);
  const [staffManagementBusy,setStaffManagementBusy] = useState(false);
  const [staffDirectoryRevision,setStaffDirectoryRevision] = useState(0);
  const [identifierPolicyBusy,setIdentifierPolicyBusy] = useState(false);
  const [membershipBusy,setMembershipBusy] = useState(false);
  const [roleManagementBusy,setRoleManagementBusy] = useState(false);
  const [tenantRoleRevision,setTenantRoleRevision] = useState(0);
  const [platformBusy,setPlatformBusy] = useState(false);
  const [activeSection,setActiveSection] = useState("");

  useEffect(() => {
    const manager = userManager;
    if (!manager) { setSessionLoading(false); return; }
    let active = true;
    manager.getUser()
      .then(async value => {
        if (!active) return;
        if (value?.expired) {
          setAuthError("Your sign-in session expired. Sign in again to continue.");
          await manager.removeUser();
          return;
        }
        setUser(value);
      })
      .catch(() => { if (active) setUser(null); })
      .finally(() => { if (active) setSessionLoading(false); });
    const loaded = (value: User) => { setAuthError(""); setUser(value); };
    const unloaded = () => setUser(null);
    const expired = () => {
      setAuthError("Your sign-in session expired. Sign in again to continue.");
      setUser(null);
      void manager.removeUser();
    };
    const renewError = () => setAuthError("Your session could not be renewed. Sign in again to continue.");
    manager.events.addUserLoaded(loaded);
    manager.events.addUserUnloaded(unloaded);
    manager.events.addAccessTokenExpired(expired);
    manager.events.addSilentRenewError(renewError);
    return () => {
      active = false;
      manager.events.removeUserLoaded(loaded);
      manager.events.removeUserUnloaded(unloaded);
      manager.events.removeAccessTokenExpired(expired);
      manager.events.removeSilentRenewError(renewError);
    };
  },[]);

  useEffect(() => {
    if (!user || !apiBaseUrl) {
      setIsPlatformOperator(false);
      setPlatformOperatorLoading(false);
      setPlatformOperatorResolved(true);
      setPlatformOperatorError("");
      return;
    }
    let active = true;
    setPlatformOperatorLoading(true);
    setPlatformOperatorResolved(false);
    setPlatformOperatorError("");
    getPlatformOperatorStatus(apiBaseUrl, user.access_token)
      .then(result => { if (active) setIsPlatformOperator(result.isPlatformOperator); })
      .catch(error => {
        if (!active) return;
        setIsPlatformOperator(false);
        setPlatformOperatorError(error instanceof ApiError && error.status === 401
          ? "Your session could not be verified for platform administration. Sign in again if this continues."
          : "Platform operator status could not be verified. Tenant workspaces remain available according to your membership.");
      })
      .finally(() => {
        if (active) {
          setPlatformOperatorLoading(false);
          setPlatformOperatorResolved(true);
        }
      });
    return () => { active = false; };
  }, [user?.access_token]);

  useEffect(() => {
    if (!user) {
      setContexts([]);
      setContextsResolved(false);
      setSelectedTenantId("");
      setHospitals([]);
      setSelectedHospitalId("");
      clearRegistrationDraft();
      return;
    }
    if (!apiBaseUrl) {
      setContextsError("Set VITE_API_BASE_URL to connect this workspace to HeapCare.Api.");
      setContextsResolved(true);
      return;
    }
    let active = true;
    setContextsLoading(true);
    setContextsResolved(false);
    setContextsError("");
    getCurrentUserTenantContexts(apiBaseUrl,user.access_token)
      .then(page => {
        if (!active) return;
        setContexts(page.items);
        const storedTenantId = readWorkspaceSelection(WORKSPACE_TENANT_SELECTION_KEY);
        const nextTenantId = resolveTenantSelection(page.items, selectedTenantId, storedTenantId);
        setSelectedTenantId(nextTenantId);
        writeWorkspaceSelection(WORKSPACE_TENANT_SELECTION_KEY, nextTenantId);
        setContextsResolved(true);
      })
      .catch(error => {
        if (active) {
          setContextsError(getErrorMessage(error));
          setContextsResolved(true);
        }
      })
      .finally(() => { if (active) setContextsLoading(false); });
    return () => { active = false; };
  },[user]);

  useEffect(() => {
    if (!user || !selectedTenantId || !apiBaseUrl) {
      setHospitals([]);
      setSelectedHospitalId("");
      return;
    }
    let active = true;
    setHospitalsLoading(true);
    setHospitalsError("");
    setSelectedHospitalId("");
    setPatients([]);
    setHasSearched(false);
    getHospitals(apiBaseUrl,user.access_token,selectedTenantId)
      .then(page => {
        if (!active) return;
        setHospitals(page.items);
        const hospitalSelectionKey = workspaceHospitalSelectionKey(selectedTenantId);
        const nextHospitalId = resolveHospitalSelection(page.items, readWorkspaceSelection(hospitalSelectionKey));
        setSelectedHospitalId(nextHospitalId);
        writeWorkspaceSelection(hospitalSelectionKey, nextHospitalId);
      })
      .catch(error => { if (active) setHospitalsError(getErrorMessage(error)); })
      .finally(() => { if (active) setHospitalsLoading(false); });
    return () => { active = false; };
  },[user,selectedTenantId]);


  useEffect(() => {
    if (!user || !apiBaseUrl || !selectedTenantId || !selectedHospitalId) {
      setDepartments([]); setSelectedDepartmentId(""); return;
    }
    let active=true;
    setDepartmentsLoading(true); setDepartmentsError("");
    listDepartments(apiBaseUrl,user.access_token,selectedTenantId,selectedHospitalId)
      .then(page=>{if(active){setDepartments(page.items);setSelectedDepartmentId(current=>page.items.some(x=>x.id===current)?current:page.items.length===1?page.items[0].id:"");}})
      .catch(error=>{if(active)setDepartmentsError(getErrorMessage(error));})
      .finally(()=>{if(active)setDepartmentsLoading(false);});
    return ()=>{active=false;};
  },[user,selectedTenantId,selectedHospitalId]);

  const selectedContext = contexts.find(value => value.tenantId === selectedTenantId);
  const selectedHospital = hospitals.find(value => value.id === selectedHospitalId);
  const hasPermission = (permission:string) => selectedContext?.permissions?.includes(permission) ?? false;
  const isClinicalWorkspace = hasPermission("encounter.read");
  const canReadPatients = hasPermission("patient.read");
  const canReadPatientIdentifiers = hasPermission("patient.identifier.read");

  useEffect(() => {
    if (canReadPatientIdentifiers || patientSearchMode !== "mrn") return;
    setPatientSearchMode("name");
    setPatientQuery("");
    setSelectedPatient(null);
    setPatients([]);
    setPatientTotal(0);
    setPatientTotalPages(0);
    setHasSearched(false);
    setSearchError("");
  }, [canReadPatientIdentifiers, patientSearchMode]);
  const canRegisterPatients = hasPermission("patient.register") && hasPermission("patient.duplicate.review");
  const canManageAppointments = hasPermission("appointment.manage");
  const canReadAppointments = hasPermission("appointment.read");
  const canPublishAvailability = hasPermission("availability.manage");
  const canReadStaff = hasPermission("staff.read");
  const canManageStaff = hasPermission("staff.manage");
  const canReadDailyCollection = hasPermission("billing.report.read");
  const canReadQueue = hasPermission("queue.read");
  const canViewOverview = canReadAppointments || canReadQueue || canReadDailyCollection;
  const canManageQueue = hasPermission("queue.manage");
  const canReadBilling = hasPermission("billing.invoice.read") || hasPermission("billing.invoice.manage");
  const canReadFacilities = hasPermission("facility.read");
  const canReadIdentifierPolicy = hasPermission("patient.identifier.policy.read");
  const canManageIdentifierPolicy = hasPermission("patient.identifier.policy.manage");
  const canAccessIdentifierPolicy = canReadIdentifierPolicy || canManageIdentifierPolicy;
  const canManageMemberships = hasPermission("membership.manage");
  const canManageRoleDefinitions = canManageMemberships &&
    selectedContext?.scopes.some(scope => scope.scopeType === "Tenant") === true;
  const selectedDepartment = departments.find(x=>x.id===selectedDepartmentId);
  const selectedSession = availabilitySessions.find(x=>x.id===selectedSessionId);
  const isWorkflowBusy = duplicateLoading||registrationLoading||availabilityLoading||slotsLoading||bookingLoading||checkInLoading||walkInLoading||queueLoading||!!queueActionLoadingId||clinicalBusy||facilityBusy||appointmentManagementBusy||staffManagementBusy||identifierPolicyBusy||membershipBusy||roleManagementBusy||platformBusy;
  const allowedSectionKey = [
    isClinicalWorkspace ? "clinical" : "",
    // Reception is the primary landing workspace for staff who can register/search
    // patients; overview remains available as a secondary navigation destination.
    canReadPatients ? "reception" : "",
    canViewOverview ? "overview" : "",
    canRegisterPatients ? "patient-registration" : "",
    canReadAppointments || canManageAppointments || canPublishAvailability ? "appointment-management" : "",
    canReadStaff || canManageStaff ? "staff-management" : "",
    canReadQueue && !isClinicalWorkspace ? "queue" : "",
    canReadBilling ? "billing" : "",
    canReadFacilities ? "facilities" : "",
    canAccessIdentifierPolicy && selectedHospitalId ? "mrn-policy" : "",
    canManageMemberships ? "memberships" : "",
    canManageRoleDefinitions ? "roles" : "",
    isPlatformOperator ? "platform-tenants" : ""
  ].filter(Boolean).join("|");
  const defaultActiveSection = allowedSectionKey.split("|")[0] || "";
  const activeWorkspaceTitle = activeSection === "overview" ? "Hospital workspace" : activeSection === "staff-management" ? "Staff and providers" : activeSection === "appointment-management" ? "Appointments" : activeSection === "appointments" ? "Appointment booking" : activeSection === "queue" ? "Queue operations" : activeSection === "billing" ? "Billing" : activeSection === "facilities" ? "Facility management" : activeSection === "mrn-policy" ? "MRN policy administration" : activeSection === "memberships" ? "Membership administration" : activeSection === "roles" ? "Roles and permissions" : activeSection === "platform-tenants" ? "Platform tenant administration" : activeSection === "patient-registration" ? "Patient registration" : activeSection === "clinical" || isClinicalWorkspace ? "Clinical workspace" : activeSection === "reception" || canReadPatients || !user ? "Reception workspace" : "Hospital workspace";

  useEffect(() => {
    if (sessionLoading || (user && (!contextsResolved || !platformOperatorResolved))) return;
    const allowedSections = allowedSectionKey ? allowedSectionKey.split("|") : [];
    const legacyHashSection = isWorkspaceModuleSection(location.hash.slice(1));
    const requestedSection = getRequestedWorkspaceSection(location.pathname, location.hash);
    // With multiple memberships, keep a deep link intact until the user chooses
    // the tenant whose persisted permissions determine whether that module is available.
    if (user && contexts.length > 1 && !selectedTenantId && requestedSection !== "platform-tenants") return;
    if (user && requestedSection === "mrn-policy" && selectedTenantId && !selectedHospitalId) return;
    const nextSection = allowedSections.includes(requestedSection)
      ? requestedSection
      : defaultActiveSection;
    setActiveSection(nextSection);

    // Keep legacy module hashes working while preserving accessibility/other in-page anchors.
    const canonicalLocation = getCanonicalWorkspaceLocation(nextSection, location.hash, legacyHashSection);
    if (`${location.pathname}${location.hash}` !== canonicalLocation) {
      navigate(canonicalLocation, { replace: true });
    }
  },[allowedSectionKey,defaultActiveSection,location.hash,location.pathname,navigate,sessionLoading,user,contextsResolved,contexts.length,selectedTenantId,selectedHospitalId,platformOperatorResolved]);

  useEffect(() => {
    const sectionId = location.hash.slice(1);
    if (!sectionId) return;
    document.getElementById(sectionId)?.scrollIntoView?.({ block: "start" });
  },[location.hash,location.pathname,activeSection,selectedHospitalId]);

  async function loadAvailability() {
    if(!user||!apiBaseUrl||!selectedTenantId||!selectedHospitalId||!selectedDepartmentId)return;
    setAvailabilityLoading(true);setAvailabilityError("");setAvailabilitySessions([]);setSelectedSessionId("");setSlots([]);setSelectedSlotStart("");setBookingError("");setBookedAppointment(null);setQueueEntry(null);
    try {
      const page=await listAvailabilitySessions(apiBaseUrl,user.access_token,selectedTenantId,selectedHospitalId,appointmentDate,selectedDepartmentId);
      setAvailabilitySessions(page.items);
      if(page.items.length===0)setAvailabilityError("No provider availability is published for this department and date.");
    } catch(error){setAvailabilityError(getErrorMessage(error));}
    finally{setAvailabilityLoading(false);}
  }

  async function selectAvailabilitySession(sessionId:string) {
    setSelectedSessionId(sessionId);setSlots([]);setSelectedSlotStart("");setAvailabilityError("");
    if(!user||!apiBaseUrl||!selectedTenantId||!selectedHospitalId||!sessionId)return;
    setSlotsLoading(true);
    try{setSlots(await getAppointmentSlots(apiBaseUrl,user.access_token,selectedTenantId,selectedHospitalId,sessionId));}
    catch(error){setAvailabilityError(getErrorMessage(error));}
    finally{setSlotsLoading(false);}
  }

  async function handleBookAppointment(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(!user||!apiBaseUrl||!selectedTenantId||!selectedHospitalId||!selectedPatient||!selectedSession||!selectedSlotStart)return;
    setBookingLoading(true);setBookingError("");setBookedAppointment(null);setQueueEntry(null);
    try{
      const result=await bookAppointment(apiBaseUrl,user.access_token,selectedTenantId,selectedHospitalId,{
        availabilitySessionId:selectedSession.id,patientId:selectedPatient.id,slotStartsAtUtc:selectedSlotStart,reason:appointmentReason.trim()||null
      });
      setBookedAppointment(result);
    }catch(error){
      if(error instanceof ApiError&&error.status===409){
        setSelectedSlotStart("");
        try{
          const refreshedSlots=await getAppointmentSlots(apiBaseUrl,user.access_token,selectedTenantId,selectedHospitalId,selectedSession.id);
          setSlots(refreshedSlots);
          setBookingError("That time was just booked or is no longer available. Availability has been refreshed; choose another available slot.");
        }catch(refreshError){
          setSlots([]);
          setAvailabilityError(getErrorMessage(refreshError));
          setBookingError("That time is no longer available. Refresh availability before choosing another slot.");
        }
      }else{
        setBookingError(getErrorMessage(error));
      }
    }
    finally{setBookingLoading(false);}
  }

  async function handleAppointmentCheckIn() {
    if(!user||!apiBaseUrl||!selectedTenantId||!selectedHospitalId||!bookedAppointment)return;
    setCheckInLoading(true);setCheckInError("");
    try{setQueueEntry(await checkInAppointment(apiBaseUrl,user.access_token,selectedTenantId,selectedHospitalId,bookedAppointment.id));}
    catch(error){setCheckInError(getErrorMessage(error));}
    finally{setCheckInLoading(false);}
  }

  async function handleWalkIn() {
    if(!user||!apiBaseUrl||!selectedTenantId||!selectedHospitalId||!selectedPatient||!selectedDepartmentId)return;
    setWalkInLoading(true);setWalkInError("");
    try{
      const entry=await createWalkIn(apiBaseUrl,user.access_token,selectedTenantId,selectedHospitalId,{departmentId:selectedDepartmentId,patientId:selectedPatient.id,timeZoneId:hospitalTimeZone});
      setBookedAppointment(null);
      setQueueEntry(entry);
      await loadQueue();
    }catch(error){setWalkInError(getErrorMessage(error));}
    finally{setWalkInLoading(false);}
  }

  async function loadQueue() {
    if(!user||!apiBaseUrl||!selectedTenantId||!selectedHospitalId||!selectedDepartmentId)return;
    setQueueLoading(true);setQueueError("");
    try{const page=await listQueue(apiBaseUrl,user.access_token,selectedTenantId,selectedHospitalId,selectedDepartmentId,queueDate);setQueueEntries(page.items);}
    catch(error){setQueueEntries([]);setQueueError(getErrorMessage(error));}
    finally{setQueueLoading(false);}
  }

  async function handleQueueAction(entry:QueueEntry,action:QueueAction) {
    if(!user||!apiBaseUrl||!selectedTenantId||!selectedHospitalId)return;
    const needsReason=action==="cancel"||action==="noshow";
    if(needsReason&&!queueActionReason.trim()){
      setQueueActionError("Enter a reason before cancelling or marking a patient as no-show.");
      return;
    }
    setQueueActionLoadingId(entry.id);setQueueActionError("");
    try{
      const updated=await transitionQueueEntry(apiBaseUrl,user.access_token,selectedTenantId,selectedHospitalId,entry.id,action,
        needsReason?{reason:queueActionReason.trim()}:{ });
      setQueueEntries(current=>current.map(item=>item.id===updated.id?updated:item));
      setQueueActionReason("");
    }catch(error){setQueueActionError(getErrorMessage(error));}
    finally{setQueueActionLoadingId("");}
  }


  async function handlePatientSearch(pageNumber = 1) {
    if (!user || !apiBaseUrl || !selectedTenantId || !selectedHospitalId) return;
    const query = patientQuery.trim();
    if (patientSearchMode === "name" && query.length < 2) {
      setSearchError("Enter at least two characters to search by patient name.");
      setPatients([]);
      setPatientTotal(0);
      setPatientTotalPages(0);
      setHasSearched(false);
      return;
    }
    if (patientSearchMode === "mrn" && !query) {
      setSearchError("Enter a medical record number to search.");
      setPatients([]);
      setPatientTotal(0);
      setPatientTotalPages(0);
      setHasSearched(false);
      return;
    }
    setSearchLoading(true);
    setSearchError("");
    setHasSearched(false);
    setPatientPage(pageNumber);
    try {
      if (patientSearchMode === "mrn") {
        const lookup = await findPatientByMrn(
          apiBaseUrl,user.access_token,selectedTenantId,selectedHospitalId,query);
        setPatients([lookup.patient]);
        setPatientTotal(1);
        setPatientTotalPages(1);
      } else {
        const page = await searchPatients(
          apiBaseUrl,user.access_token,selectedTenantId,selectedHospitalId,query,pageNumber);
        setPatients(page.items);
        setPatientTotal(page.totalCount);
        setPatientTotalPages(page.totalPages);
      }
      setHasSearched(true);
    } catch (error) {
      setPatients([]);
      setPatientTotal(0);
      setPatientTotalPages(0);
      setSearchError(getErrorMessage(error));
    } finally {
      setSearchLoading(false);
    }
  }

  function registrationInput(): PatientRegistrationInput {
    return {
      givenName: registrationGivenName.trim(),
      middleName: registrationMiddleName.trim() || null,
      familyName: registrationFamilyName.trim() || null,
      dateOfBirth: registrationDob || null
    };
  }

  function resetRegistrationReview() {
    setDuplicateCheck(null);
    setDuplicateError("");
    setDuplicateAcknowledged(false);
    setRegistrationError("");
    setRegistrationSuccess("");
  }

  function clearRegistrationDraft() {
    setRegistrationGivenName("");
    setRegistrationMiddleName("");
    setRegistrationFamilyName("");
    setRegistrationDob("");
    setDuplicateCheck(null);
    setDuplicateError("");
    setDuplicateAcknowledged(false);
    setRegistrationError("");
    setRegistrationSuccess("");
  }

  async function handleDuplicateCheck() {
    if (!user || !apiBaseUrl || !selectedTenantId || !selectedHospitalId) return;
    if (!registrationGivenName.trim()) {
      setDuplicateError("Given name is required before checking for possible duplicates.");
      return;
    }
    setDuplicateLoading(true);
    setDuplicateError("");
    setRegistrationError("");
    setRegistrationSuccess("");
    setDuplicateAcknowledged(false);
    try {
      const result = await checkPatientDuplicateCandidates(
        apiBaseUrl,user.access_token,selectedTenantId,selectedHospitalId,registrationInput());
      setDuplicateCheck(result);
    } catch (error) {
      setDuplicateCheck(null);
      setDuplicateError(getErrorMessage(error));
    } finally {
      setDuplicateLoading(false);
    }
  }

  async function handlePatientRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !apiBaseUrl || !selectedTenantId || !selectedHospitalId) return;
    if (!duplicateCheck || !duplicateAcknowledged) {
      setRegistrationError("Complete the duplicate review and confirm that this is a new patient before registering.");
      return;
    }
    setRegistrationLoading(true);
    setRegistrationError("");
    setRegistrationSuccess("");
    try {
      const patient = await registerPatient(
        apiBaseUrl,user.access_token,selectedTenantId,selectedHospitalId,registrationInput());
      try {
        const identifier = await assignPatientMedicalRecordNumber(
          apiBaseUrl,user.access_token,selectedTenantId,selectedHospitalId,patient.id);
        setRegistrationSuccess(`Patient ${patientName(patient)} was registered successfully and MRN ${identifier.value} was assigned.`);
      } catch {
        setRegistrationSuccess(`Patient ${patientName(patient)} was registered successfully. MRN assignment is pending; ask an authorized administrator to verify the hospital MRN policy and your identifier permissions.`);
      }
      setPatients([]);
      setHasSearched(false);
      setPatientTotal(0);
      setPatientTotalPages(0);
      setRegistrationGivenName("");
      setRegistrationMiddleName("");
      setRegistrationFamilyName("");
      setRegistrationDob("");
      setDuplicateCheck(null);
      setDuplicateAcknowledged(false);
    } catch (error) {
      setRegistrationError(getErrorMessage(error));
    } finally {
      setRegistrationLoading(false);
    }
  }

  function changeTenant(tenantId: string) {
    if (tenantId === selectedTenantId) return;
    writeWorkspaceSelection(WORKSPACE_TENANT_SELECTION_KEY, tenantId);
    setSelectedTenantId(tenantId);
    setSelectedPatient(null); setAvailabilitySessions([]); setSlots([]); setBookedAppointment(null); setQueueEntry(null); setQueueEntries([]);
    setSelectedHospitalId("");
    setHospitals([]);
    setPatients([]);
    setPatientTotal(0);
    setPatientTotalPages(0);
    setPatientPage(1);
    setPatientQuery("");
    setPatientSearchMode("name");
    setHasSearched(false);
    setSearchError("");
    clearRegistrationDraft();
  }

  function changeHospital(hospitalId: string) {
    writeWorkspaceSelection(workspaceHospitalSelectionKey(selectedTenantId), hospitalId);
    setSelectedHospitalId(hospitalId);
    setSelectedPatient(null); setAvailabilitySessions([]); setSlots([]); setBookedAppointment(null); setQueueEntry(null); setQueueEntries([]);
    setPatients([]);
    setPatientTotal(0);
    setPatientTotalPages(0);
    setPatientPage(1);
    setPatientQuery("");
    setPatientSearchMode("name");
    setHasSearched(false);
    setSearchError("");
    clearRegistrationDraft();
  }

  async function refreshHospitals(preferredHospitalId?: string) {
    if (!user || !apiBaseUrl || !selectedTenantId) return;
    setHospitalsLoading(true);
    try {
      const page = await getHospitals(apiBaseUrl,user.access_token,selectedTenantId);
      setHospitals(page.items);
      const nextHospitalId = preferredHospitalId && page.items.some(item => item.id === preferredHospitalId)
        ? preferredHospitalId
        : page.items.some(item => item.id === selectedHospitalId)
          ? selectedHospitalId
          : page.items.length === 1 ? page.items[0].id : "";
      writeWorkspaceSelection(workspaceHospitalSelectionKey(selectedTenantId), nextHospitalId);
      if (nextHospitalId !== selectedHospitalId) changeHospital(nextHospitalId);
      else setSelectedHospitalId(nextHospitalId);
    } finally {
      setHospitalsLoading(false);
    }
  }

  async function refreshDepartments() {
    if (!user || !apiBaseUrl || !selectedTenantId || !selectedHospitalId) {
      setDepartments([]);
      setSelectedDepartmentId("");
      setDepartmentsLoading(false);
      return;
    }
    setDepartmentsLoading(true);
    try {
      const page = await listDepartments(apiBaseUrl,user.access_token,selectedTenantId,selectedHospitalId);
      setDepartments(page.items);
      setSelectedDepartmentId(current =>
        page.items.some(item => item.id === current)
          ? current
          : page.items.length === 1 ? page.items[0].id : "");
    } finally {
      setDepartmentsLoading(false);
    }
  }

  return <div className="shell">
    <a className="skip-link" href="#workspace-main">Skip to main content</a>
    <aside className="sidebar">
      <div className="brand"><b>C</b><span>HeapCare<small>HOSPITAL WORKSPACE</small></span></div>
      <nav aria-label="Primary navigation">
        <p>WORKSPACE</p>
        {isClinicalWorkspace&&<Link className={activeSection==="clinical"?"selected":undefined} aria-current={activeSection==="clinical"?"location":undefined} to="/clinical#clinical">Clinical workspace</Link>}{canReadPatients&&<Link className={activeSection==="reception"?"selected":undefined} aria-current={activeSection==="reception"?"location":undefined} to="/reception#reception">Reception</Link>}{canRegisterPatients&&<Link className={activeSection==="patient-registration"?"selected":undefined} aria-current={activeSection==="patient-registration"?"location":undefined} to="/patient-registration#patient-registration">Patient registration</Link>}{canViewOverview&&<Link className={activeSection==="overview"?"selected":undefined} aria-current={activeSection==="overview"?"location":undefined} to="/overview#overview">Overview</Link>}{(canReadAppointments||canManageAppointments||canPublishAvailability)&&<Link className={activeSection==="appointment-management"?"selected":undefined} aria-current={activeSection==="appointment-management"?"location":undefined} to="/appointment-management#appointment-management">Appointments</Link>}{(canReadStaff||canManageStaff)&&<Link className={activeSection==="staff-management"?"selected":undefined} aria-current={activeSection==="staff-management"?"location":undefined} to="/staff-management#staff-management">Staff</Link>}{canReadQueue&&!isClinicalWorkspace&&<Link className={activeSection==="queue"?"selected":undefined} aria-current={activeSection==="queue"?"location":undefined} to="/queue#queue">Queue</Link>}{canReadBilling&&<Link className={activeSection==="billing"?"selected":undefined} aria-current={activeSection==="billing"?"location":undefined} to="/billing#billing">Billing</Link>}{canReadFacilities&&<Link className={activeSection==="facilities"?"selected":undefined} aria-current={activeSection==="facilities"?"location":undefined} to="/facilities#facilities">Facilities</Link>}{canAccessIdentifierPolicy&&selectedHospitalId&&<Link className={activeSection==="mrn-policy"?"selected":undefined} aria-current={activeSection==="mrn-policy"?"location":undefined} to="/mrn-policy#mrn-policy">MRN policy</Link>}{canManageMemberships&&<Link className={activeSection==="memberships"?"selected":undefined} aria-current={activeSection==="memberships"?"location":undefined} to="/memberships#memberships">Memberships</Link>}{canManageRoleDefinitions&&<Link className={activeSection==="roles"?"selected":undefined} aria-current={activeSection==="roles"?"location":undefined} to="/roles#roles">Roles &amp; permissions</Link>}{isPlatformOperator&&<><p>PLATFORM</p><Link className={activeSection==="platform-tenants"?"selected":undefined} aria-current={activeSection==="platform-tenants"?"location":undefined} to="/platform-tenants#platform-tenants">Tenant lifecycle</Link></>}{!isClinicalWorkspace&&!canReadPatients&&!canManageAppointments&&!canReadQueue&&!canReadBilling&&!canRegisterPatients&&!canReadFacilities&&!canAccessIdentifierPolicy&&!canReadAppointments&&!canManageAppointments&&!canPublishAvailability&&!canReadStaff&&!canManageStaff&&!canViewOverview&&!canManageMemberships&&!canManageRoleDefinitions&&!isPlatformOperator&&<span className="inline-status">No workspace modules are assigned to this membership.</span>}
      </nav>
      <footer>Secure by design<br/><small>{isPlatformOperator && activeSection==="platform-tenants" ? "Platform control plane" : "Tenant-scoped access"}</small></footer>
    </aside>
    <main className="content" id="workspace-main" tabIndex={-1}>
      <header>
        <div><label>{activeSection==="platform-tenants" ? "HEAPCARE PLATFORM" : "HOSPITAL OPERATIONS"}</label><h1>{activeWorkspaceTitle}</h1></div>
        <div className="session">
          {sessionLoading ? "Checking session…" : user ?
            <><span>{String(user.profile.name ?? user.profile.preferred_username ?? "Signed-in user")}</span>
            <button onClick={() => userManager?.signoutRedirect()}>Sign out</button></> :
            <button disabled={!isAuthenticationConfigured} onClick={() => userManager?.signinRedirect()}>Sign in</button>}
        </div>
      </header>

      {authError && <div className="notice" role="alert">{authError}</div>}
      {platformOperatorError && <div className="notice" role="status">{platformOperatorError}</div>}
      {!isAuthenticationConfigured && <div className="notice" role="status"><b>Authentication setup required.</b> Configure the OIDC environment variables before enabling staff sign-in.</div>}
      {user && !apiBaseUrl && <div className="notice" role="alert">Set VITE_API_BASE_URL to connect this workspace to HeapCare.Api.</div>}
      {user && apiBaseUrl && <>
        <section className="context-panel">
          <div className="context-intro">
            <label>ACTIVE ORGANIZATION</label>
            <h2>{selectedHospital?.name ?? selectedContext?.tenantName ?? "Select your hospital context"}</h2>
            <p>{selectedHospital ? `Working in ${selectedHospital.name}. Data access is scoped to this selected hospital.` : selectedContext ? `Tenant ${selectedContext.tenantName} is selected. Choose a hospital to continue.` : "Only active memberships assigned to your validated sign-in are listed."}</p>
            {selectedContext && <div className="context-tags"><span>{selectedContext.role}</span><span>{selectedHospital ? "Hospital selected" : "Hospital required"}</span></div>}
          </div>
          <div className="context-controls">
            <label htmlFor="tenant-select">Tenant</label>
            <select id="tenant-select" value={selectedTenantId} onChange={event => changeTenant(event.target.value)} disabled={contextsLoading || contexts.length === 0 || isWorkflowBusy}>
              <option value="">Select a tenant</option>
              {contexts.map(context => <option key={context.tenantId} value={context.tenantId}>{context.tenantName} · {context.role}</option>)}
            </select>
            <label htmlFor="hospital-select">Hospital</label>
            <select id="hospital-select" value={selectedHospitalId} onChange={event => changeHospital(event.target.value)} disabled={!selectedTenantId || hospitalsLoading || hospitals.length === 0 || isWorkflowBusy}>
              <option value="">Select a hospital</option>
              {hospitals.map(hospital => <option key={hospital.id} value={hospital.id}>{hospital.name}{hospital.code ? ` · ${hospital.code}` : ""}</option>)}
            </select>
          </div>
          {contextsLoading && <p className="inline-status" role="status">Loading your active tenant memberships…</p>}
          {contextsError && <p className="inline-error" role="alert">{contextsError}</p>}
          {!contextsLoading && !contextsError && contexts.length === 0 && !platformOperatorLoading && !isPlatformOperator && !localPlatformBootstrapEnabled && <p className="inline-status">No active tenant membership was found for this identity. Contact your HeapCare administrator.</p>}
          {!contextsLoading && !contextsError && contexts.length === 0 && !platformOperatorLoading && isPlatformOperator && <p className="inline-status">Platform operator access is active. Use Platform tenants to provision and manage customer tenants.</p>}
          {!contextsLoading && !contextsError && contexts.length === 0 && localPlatformBootstrapEnabled && !platformOperatorLoading && !platformOperatorError && !isPlatformOperator && <p className="inline-status">If this is your first local installation, use the guided setup below to provision the first platform operator, tenant, hospital and department.</p>}
          {selectedContext && <p className="context-scope">Role: <strong>{selectedContext.role}</strong> · {selectedContext.scopes.map(scope => scope.scopeType).join(", ")} scope</p>}
          {hospitalsLoading && <p className="inline-status" role="status">Loading hospitals available to this membership…</p>}
          {hospitalsError && <p className="inline-error" role="alert">{hospitalsError}</p>}
          {selectedTenantId && !hospitalsLoading && !hospitalsError && hospitals.length === 0 && <p className="inline-status">No hospitals are available in the selected tenant or within your assigned scope.</p>}
        </section>

        {canViewOverview && selectedHospital && selectedTenantId && user && apiBaseUrl && <div className="workspace-route" hidden={activeSection !== "overview"}><HospitalOverview
          baseUrl={apiBaseUrl}
          accessToken={user.access_token}
          tenantId={selectedTenantId}
          hospitalId={selectedHospital.id}
          hospitalName={selectedHospital.name}
          departments={departments}
          timeZoneId={hospitalTimeZone}
          canReadAppointments={canReadAppointments}
          canReadQueue={canReadQueue}
          canReadCollection={canReadDailyCollection}
          canReadBilling={canReadBilling}
          canReadPatients={canReadPatients}
          canReadStaff={canReadStaff}
          isActive={activeSection === "overview"}
        /></div>}

        {localPlatformBootstrapEnabled && !platformOperatorLoading && !platformOperatorError && !isPlatformOperator && !contextsLoading && !contextsError && contexts.length===0 && user && <PlatformOnboarding user={user} onComplete={async()=>{const page=await getCurrentUserTenantContexts(apiBaseUrl??"",user.access_token);setContexts(page.items);setSelectedTenantId(page.items[0]?.tenantId??"");}}/>}

        {isPlatformOperator && user && apiBaseUrl && <div className="workspace-route" hidden={activeSection !== "platform-tenants"}><PlatformTenantManagement
          baseUrl={apiBaseUrl}
          accessToken={user.access_token}
          currentIssuer={String(user.profile.iss ?? "")}
          onBusyChange={setPlatformBusy}
        /></div>}

        {canReadFacilities && selectedContext && selectedTenantId && <div className="workspace-route" hidden={activeSection !== "facilities"}><FacilityManagement
          baseUrl={apiBaseUrl}
          accessToken={user.access_token}
          tenantId={selectedTenantId}
          hospital={selectedHospital}
          departments={departments}
          departmentsLoading={departmentsLoading}
          permissions={selectedContext.permissions ?? []}
          scopes={selectedContext.scopes ?? []}
          onRefreshHospitals={refreshHospitals}
          onRefreshDepartments={refreshDepartments}
          onBusyChange={setFacilityBusy}
        /></div>}

        {(canReadStaff || canManageStaff) && selectedHospital && selectedTenantId && user && apiBaseUrl && <div className="workspace-route" hidden={activeSection !== "staff-management"}><StaffManagement
          baseUrl={apiBaseUrl}
          accessToken={user.access_token}
          tenantId={selectedTenantId}
          hospitalId={selectedHospital.id}
          hospitalName={selectedHospital.name}
          departments={departments}
          canRead={canReadStaff}
          canManage={canManageStaff}
          onBusyChange={setStaffManagementBusy}
          onDirectoryChanged={() => setStaffDirectoryRevision(current => current + 1)}
        /></div>}

        {canAccessIdentifierPolicy && selectedHospital && selectedTenantId && user && apiBaseUrl && <div className="workspace-route" hidden={activeSection !== "mrn-policy"}><PatientIdentifierPolicyManagement
          baseUrl={apiBaseUrl}
          accessToken={user.access_token}
          tenantId={selectedTenantId}
          hospitalId={selectedHospital.id}
          hospitalName={selectedHospital.name}
          canRead={canReadIdentifierPolicy}
          canManage={canManageIdentifierPolicy}
          onBusyChange={setIdentifierPolicyBusy}
        /></div>}

        {canManageMemberships && selectedContext && selectedTenantId && <div className="workspace-route" hidden={activeSection !== "memberships"}><TenantMembershipManagement
          baseUrl={apiBaseUrl}
          accessToken={user.access_token}
          tenantId={selectedTenantId}
          currentIssuer={String(user.profile.iss ?? "")}
          currentSubject={String(user.profile.sub ?? "")}
          permissions={selectedContext.permissions ?? []}
          scopes={selectedContext.scopes ?? []}
          hospitals={hospitals}
          roleRevision={tenantRoleRevision}
          onBusyChange={setMembershipBusy}
        /></div>}

        {canManageRoleDefinitions && selectedContext && selectedTenantId && <div className="workspace-route" hidden={activeSection !== "roles"}><TenantRoleManagement
          baseUrl={apiBaseUrl}
          accessToken={user.access_token}
          tenantId={selectedTenantId}
          permissions={selectedContext.permissions ?? []}
          scopes={selectedContext.scopes ?? []}
          onBusyChange={setRoleManagementBusy}
          onRolesChanged={() => setTenantRoleRevision(value => value + 1)}
        /></div>}

        {canReadPatients && <div className="workspace-route" hidden={activeSection !== "reception"}>
          <ReceptionWorkspace
            hasSelectedHospital={!!selectedHospitalId}
            patientSearchMode={patientSearchMode}
            patientQuery={patientQuery}
            searchLoading={searchLoading}
            isWorkflowBusy={isWorkflowBusy}
            canReadPatientIdentifiers={canReadPatientIdentifiers}
            searchError={searchError}
            hasSearched={hasSearched}
            patientPage={patientPage}
            patientTotal={patientTotal}
            patientTotalPages={patientTotalPages}
            patients={patients}
            selectedPatientId={selectedPatient?.id}
            onSearchModeChange={mode => {
              setPatientSearchMode(mode);
              setPatientQuery("");
              setSelectedPatient(null);
              setHasSearched(false);
              setPatients([]);
              setPatientTotal(0);
              setPatientTotalPages(0);
              setSearchError("");
            }}
            onQueryChange={query => {
              setPatientQuery(query);
              setSelectedPatient(null);
              setHasSearched(false);
              setPatients([]);
              setPatientTotal(0);
              setPatientTotalPages(0);
              setSearchError("");
            }}
            onSearch={handlePatientSearch}
            onSelectPatient={patient => {
              setSelectedPatient(patient);
              setBookedAppointment(null);
              setQueueEntry(null);
              setBookingError("");
              setWalkInError("");
            }}
          />
        </div>}


        {canManageAppointments && <div className="workspace-route" hidden={activeSection !== "appointment-management"}>
          <AppointmentBookingWorkspace hasSelectedPatient={!!selectedPatient} selectedPatientName={selectedPatient ? patientName(selectedPatient) : ""} departments={departments} selectedDepartmentId={selectedDepartmentId} selectedDepartmentName={selectedDepartment?.name || ""} departmentsLoading={departmentsLoading} departmentsError={departmentsError} isWorkflowBusy={isWorkflowBusy} appointmentDate={appointmentDate} availabilityLoading={availabilityLoading} availabilityError={availabilityError} availabilitySessions={availabilitySessions} selectedSessionId={selectedSessionId} slotsLoading={slotsLoading} slots={slots} selectedSlotStart={selectedSlotStart} selectedSessionTimeZoneId={selectedSession?.timeZoneId} bookedAppointment={bookedAppointment} appointmentReason={appointmentReason} bookingLoading={bookingLoading} bookingError={bookingError} checkInLoading={checkInLoading} checkInError={checkInError} queueEntry={queueEntry}
            onDepartmentChange={value=>{setSelectedDepartmentId(value);setAvailabilitySessions([]);setSlots([]);setSelectedSessionId("");setSelectedSlotStart("");setQueueEntries([]);setBookedAppointment(null);setQueueEntry(null);}}
            onAppointmentDateChange={value=>{setAppointmentDate(value);setAvailabilitySessions([]);setSlots([]);setSelectedSessionId("");setSelectedSlotStart("");}}
            onLoadAvailability={loadAvailability} onSelectSession={selectAvailabilitySession} onSelectSlot={setSelectedSlotStart} onSubmit={handleBookAppointment} onAppointmentReasonChange={setAppointmentReason} onCheckIn={handleAppointmentCheckIn}
          />
        </div>}

        {(canReadAppointments || canManageAppointments || canPublishAvailability) && selectedTenantId && selectedHospitalId && user && apiBaseUrl && <div className="workspace-route" hidden={activeSection !== "appointment-management"}><AppointmentManagement
          baseUrl={apiBaseUrl}
          accessToken={user.access_token}
          tenantId={selectedTenantId}
          hospitalId={selectedHospitalId}
          departments={departments}
          canRead={canReadAppointments}
          canManage={canManageAppointments}
          canPublishAvailability={canPublishAvailability}
          staffRevision={staffDirectoryRevision}
          onBusyChange={setAppointmentManagementBusy}
        /></div>}

        {(canManageQueue || canReadQueue) && selectedTenantId && selectedHospitalId && user && apiBaseUrl && <div className="workspace-route" hidden={activeSection !== "queue"}>
          <QueueWorkspace hasSelectedPatient={!!selectedPatient} selectedPatientName={selectedPatient ? patientName(selectedPatient) : ""} selectedDepartmentName={selectedDepartment?.name || ""} selectedDepartmentId={selectedDepartmentId} departments={departments} isWorkflowBusy={isWorkflowBusy} hospitalTimeZone={hospitalTimeZone} walkInLoading={walkInLoading} walkInError={walkInError} queueEntry={queueEntry} bookedAppointment={bookedAppointment} queueDate={queueDate} queueLoading={queueLoading} queueError={queueError} canManageQueue={canManageQueue} canReadQueue={canReadQueue} queueEntries={queueEntries} queueActionReason={queueActionReason} queueActionError={queueActionError} queueActionLoadingId={queueActionLoadingId}
            onHospitalTimeZoneChange={setHospitalTimeZone} onWalkIn={handleWalkIn} onDepartmentChange={value=>{setSelectedDepartmentId(value);setQueueEntries([]);}} onQueueDateChange={value=>{setQueueDate(value);setQueueEntries([]);}} onLoadQueue={loadQueue} onQueueActionReasonChange={setQueueActionReason} onQueueAction={handleQueueAction}
          />
        </div>}

        {canReadBilling && selectedTenantId && selectedHospitalId && user && <div className="workspace-route" hidden={activeSection !== "billing"}><BillingWorkspace baseUrl={apiBaseUrl} accessToken={user.access_token} tenantId={selectedTenantId} hospitalId={selectedHospitalId} departments={departments} permissions={selectedContext?.permissions??[]}/></div>}

        {isClinicalWorkspace && selectedTenantId && selectedHospitalId && user && <div className="workspace-route" hidden={activeSection !== "clinical"}><ClinicalWorkspace baseUrl={apiBaseUrl} accessToken={user.access_token} tenantId={selectedTenantId} hospitalId={selectedHospitalId} departments={departments} permissions={selectedContext?.permissions??[]} onBusyChange={setClinicalBusy}/></div>}

        {canRegisterPatients && <div className="workspace-route" hidden={activeSection !== "patient-registration"}>
          <PatientRegistrationWorkspace
            hospitalSelected={!!selectedHospitalId}
            givenName={registrationGivenName}
            middleName={registrationMiddleName}
            familyName={registrationFamilyName}
            dateOfBirth={registrationDob}
            duplicateLoading={duplicateLoading}
            duplicateError={duplicateError}
            duplicateCheck={duplicateCheck}
            duplicateAcknowledged={duplicateAcknowledged}
            registrationLoading={registrationLoading}
            registrationError={registrationError}
            registrationSuccess={registrationSuccess}
            onGivenNameChange={value => { setRegistrationGivenName(value); resetRegistrationReview(); }}
            onMiddleNameChange={value => { setRegistrationMiddleName(value); resetRegistrationReview(); }}
            onFamilyNameChange={value => { setRegistrationFamilyName(value); resetRegistrationReview(); }}
            onDateOfBirthChange={value => { setRegistrationDob(value); resetRegistrationReview(); }}
            onCheckDuplicates={handleDuplicateCheck}
            onDuplicateAcknowledgedChange={setDuplicateAcknowledged}
            onSubmit={handlePatientRegistration}
          />
        </div>}
      </>}

      {!user && !sessionLoading && <section className="hero"><label>YOUR HOSPITAL, ONE WORKSPACE</label><h2>Good care starts with<br/><em>connected workflows.</em></h2><p>Sign in with your hospital identity to access the work areas assigned to you.</p><div className="symbol" aria-hidden="true">✚</div></section>}
      <footer className="pagefoot">HeapCare · Hospital information workspace <span>API authorization is enforced on every request.</span></footer>
    </main>
  </div>;
}

export function App() {
  return <Routes><Route path="/auth/callback" element={<Callback/>}/><Route path="/auth/silent-callback" element={<SilentCallback/>}/><Route path="*" element={<Workspace/>}/></Routes>;
}
