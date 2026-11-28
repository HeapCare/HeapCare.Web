import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTenantMembership,
  deactivateTenantMembership,
  listDepartments,
  listTenantMemberships,
  listTenantRoles,
  reactivateTenantMembership,
  updateTenantMembership
} from "../../api/heapcare";
import type { Hospital, TenantMembership } from "../../api/heapcare";
import { TenantMembershipManagement } from "./TenantMembershipManagement";

vi.mock("../../api/heapcare", () => ({
  ApiError: class ApiError extends Error {
    constructor(readonly status: number) {
      super("Membership request failed.");
    }
  },
  createTenantMembership: vi.fn(),
  deactivateTenantMembership: vi.fn(),
  listDepartments: vi.fn(),
  listTenantMemberships: vi.fn(),
  listTenantRoles: vi.fn(),
  reactivateTenantMembership: vi.fn(),
  updateTenantMembership: vi.fn()
}));

const hospital: Hospital = { id: "hospital-1", name: "City Hospital", code: "CITY" };
const tenantScope = [{ scopeType: "Tenant" as const, hospitalId: null, departmentId: null }];
const hospitalScope = [{ scopeType: "Hospital" as const, hospitalId: hospital.id, departmentId: null }];
const membership: TenantMembership = {
  id: "membership-1",
  issuer: "https://identity.example.test",
  subject: "another-user-subject",
  role: "FacilityViewer",
  isActive: true,
  createdAtUtc: "2026-11-26T00:00:00Z",
  updatedAtUtc: "2026-11-26T00:00:00Z",
  scopes: hospitalScope
};
const availableRoles = [
  { id: "role-admin", code: "HospitalAdmin", name: "Hospital Administrator", description: "Tenant administrator", isSystem: true, isActive: true, permissionCodes: ["membership.manage"], createdAtUtc: "", updatedAtUtc: "" },
  { id: "role-viewer", code: "FacilityViewer", name: "Facility Viewer", description: "Read-only facility access", isSystem: true, isActive: true, permissionCodes: ["facility.read"], createdAtUtc: "", updatedAtUtc: "" },
  { id: "role-manager", code: "FacilityManager", name: "Facility Manager", description: "Facility updates", isSystem: true, isActive: true, permissionCodes: ["facility.read", "facility.write"], createdAtUtc: "", updatedAtUtc: "" },
  { id: "role-clinical", code: "ClinicalUser", name: "Clinical User", description: "Clinical workflow", isSystem: true, isActive: true, permissionCodes: ["encounter.read"], createdAtUtc: "", updatedAtUtc: "" }
];
const page = (items: TenantMembership[]) => ({
  items, page: 1, pageSize: 50, totalCount: items.length, totalPages: items.length ? 1 : 0
});
const props = {
  baseUrl: "https://api.example.test",
  accessToken: "test-token",
  tenantId: "tenant-1",
  currentIssuer: "https://identity.example.test",
  currentSubject: "current-admin-subject",
  permissions: ["membership.manage"],
  scopes: tenantScope,
  hospitals: [hospital],
  roleRevision: 0,
  onBusyChange: vi.fn()
};

describe("TenantMembershipManagement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listTenantMemberships).mockResolvedValue(page([membership]));
    vi.mocked(listTenantRoles).mockResolvedValue(availableRoles);
    vi.mocked(listDepartments).mockResolvedValue({
      items: [{ id: "department-1", hospitalId: hospital.id, name: "Medicine", code: "MED" }],
      page: 1, pageSize: 100, totalCount: 1, totalPages: 1
    });
    vi.mocked(createTenantMembership).mockResolvedValue(membership);
    vi.mocked(updateTenantMembership).mockResolvedValue(membership);
    vi.mocked(deactivateTenantMembership).mockResolvedValue({ ...membership, isActive: false });
    vi.mocked(reactivateTenantMembership).mockResolvedValue(membership);
  });

  it("loads tenant memberships with current role and organization scope", async () => {
    render(<TenantMembershipManagement {...props} />);

    expect(await screen.findByText("another-user-subject")).toBeInTheDocument();
    expect(screen.getAllByText("FacilityViewer").length).toBeGreaterThan(0);
    expect(screen.getAllByText("City Hospital").length).toBeGreaterThan(0);
    expect(listTenantMemberships).toHaveBeenCalledWith(
      "https://api.example.test", "test-token", "tenant-1", 1
    );
    expect(listTenantRoles).toHaveBeenCalledWith(
      "https://api.example.test", "test-token", "tenant-1"
    );
  });

  it("creates a membership using the validated issuer and selected department scope", async () => {
    render(<TenantMembershipManagement {...props} />);

    fireEvent.change(screen.getByLabelText("OIDC subject *"), {
      target: { value: "new-user-subject" }
    });
    fireEvent.change(screen.getByLabelText("Tenant role"), {
      target: { value: "ClinicalUser" }
    });
    fireEvent.change(screen.getByLabelText("Scope type"), {
      target: { value: "Department" }
    });

    await screen.findByRole("option", { name: "Medicine · MED" });
    fireEvent.change(screen.getByLabelText("Department"), {
      target: { value: "department-1" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Create membership" }));

    await waitFor(() => expect(createTenantMembership).toHaveBeenCalledWith(
      "https://api.example.test",
      "test-token",
      "tenant-1",
      {
        issuer: "https://identity.example.test",
        subject: "new-user-subject",
        role: "ClinicalUser",
        scopes: [{ scopeType: "Department", hospitalId: hospital.id, departmentId: "department-1" }]
      }
    ));
    expect(await screen.findByText("Membership created.")).toBeInTheDocument();
  });

  it("updates role and scopes while preserving the membership identity", async () => {
    render(<TenantMembershipManagement {...props} />);

    await screen.findByRole("option", { name: "Facility Manager" });
    fireEvent.click(await screen.findByRole("button", { name: "Edit access" }));
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "FacilityManager" } });
    fireEvent.click(screen.getByRole("button", { name: "Save access" }));

    await waitFor(() => expect(updateTenantMembership).toHaveBeenCalledWith(
      "https://api.example.test",
      "test-token",
      "tenant-1",
      membership.id,
      { role: "FacilityManager", scopes: hospitalScope }
    ));
    expect(await screen.findByText("Membership access updated.")).toBeInTheDocument();
  });

  it("requires confirmation before deactivating a membership", async () => {
    render(<TenantMembershipManagement {...props} />);

    fireEvent.click(await screen.findByRole("button", { name: "Deactivate" }));
    const confirmation = screen.getByRole("group", {
      name: "Deactivate membership for another-user-subject?"
    });
    expect(confirmation).toBeInTheDocument();
    expect(confirmation).toHaveAccessibleName("Deactivate membership for another-user-subject?");
    expect(screen.getByRole("button", { name: "Confirm deactivation" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(deactivateTenantMembership).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Confirm deactivation" }));
    await waitFor(() => expect(deactivateTenantMembership).toHaveBeenCalledWith(
      "https://api.example.test", "test-token", "tenant-1", membership.id
    ));
  });

  it("does not offer self-management actions for the current identity", async () => {
    const ownMembership = { ...membership, subject: props.currentSubject };
    vi.mocked(listTenantMemberships).mockResolvedValue(page([ownMembership]));
    render(<TenantMembershipManagement {...props} />);

    expect(await screen.findByText("Your account")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit access" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Deactivate" })).toBeDisabled();
  });

  it("announces membership list failures through the alert role", async () => {
    vi.mocked(listTenantMemberships).mockRejectedValueOnce(new Error("Membership service unavailable."));

    render(<TenantMembershipManagement {...props} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Membership service unavailable.");
  });

  it("announces a rejected membership mutation and preserves the form for correction", async () => {
    const { ApiError } = await import("../../api/heapcare");
    vi.mocked(createTenantMembership).mockRejectedValueOnce(new ApiError(409));

    render(<TenantMembershipManagement {...props} />);

    await screen.findByRole("option", { name: "Facility Viewer" });
    fireEvent.change(screen.getByLabelText("OIDC subject *"), {
      target: { value: "conflicting-user-subject" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Create membership" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The membership changed or a protected administrator rule prevents this action."
    );
    expect(screen.getByLabelText("OIDC subject *")).toHaveValue("conflicting-user-subject");
    expect(createTenantMembership).toHaveBeenCalledTimes(1);
  });

  it("reactivates an inactive membership after explicit confirmation", async () => {
    vi.mocked(listTenantMemberships).mockResolvedValue(page([{ ...membership, isActive: false }]));
    render(<TenantMembershipManagement {...props} />);

    fireEvent.click(await screen.findByRole("button", { name: "Reactivate" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm reactivation" }));

    await waitFor(() => expect(reactivateTenantMembership).toHaveBeenCalledWith(
      "https://api.example.test", "test-token", "tenant-1", membership.id
    ));
  });
});
