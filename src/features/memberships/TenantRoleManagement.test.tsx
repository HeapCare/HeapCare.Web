import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTenantRole,
  deactivateTenantRole,
  listAssignableTenantPermissions,
  listTenantRoles,
  reactivateTenantRole,
  updateTenantRole
} from "../../api/heapcare";
import { TenantRoleManagement } from "./TenantRoleManagement";

vi.mock("../../api/heapcare", () => ({
  ApiError: class ApiError extends Error {
    constructor(readonly status: number) { super("Role request failed."); }
  },
  createTenantRole: vi.fn(),
  deactivateTenantRole: vi.fn(),
  listAssignableTenantPermissions: vi.fn(),
  listTenantRoles: vi.fn(),
  reactivateTenantRole: vi.fn(),
  updateTenantRole: vi.fn()
}));

const roles = [
  {
    id: "system-admin",
    code: "HospitalAdmin",
    name: "Hospital Administrator",
    description: "Tenant-wide hospital administrator.",
    isSystem: true,
    isActive: true,
    permissionCodes: ["membership.manage", "facility.read", "facility.write"],
    createdAtUtc: "",
    updatedAtUtc: ""
  },
  {
    id: "custom-viewer",
    code: "custom_viewer_123",
    name: "Facility Viewer",
    description: "Can only read facility structure.",
    isSystem: false,
    isActive: true,
    permissionCodes: ["facility.read"],
    createdAtUtc: "",
    updatedAtUtc: ""
  }
];

const permissionDefinitions = [
  {
    code: "facility.read",
    module: "Facilities",
    resource: "facility",
    action: "read",
    displayName: "View facility structure",
    description: "Read hospitals, departments, wards, rooms and beds.",
    risk: "Standard" as const,
    isAssignable: true
  },
  {
    code: "facility.write",
    module: "Facilities",
    resource: "facility",
    action: "write",
    displayName: "Create and update facilities",
    description: "Create and update facility structure.",
    risk: "Sensitive" as const,
    isAssignable: true
  }
];

const props = {
  baseUrl: "https://api.example.test",
  accessToken: "access-token",
  tenantId: "tenant-1",
  permissions: ["membership.manage", "facility.read", "facility.write"],
  scopes: [{ scopeType: "Tenant" as const, hospitalId: null, departmentId: null }],
  onBusyChange: vi.fn(),
  onRolesChanged: vi.fn()
};

describe("TenantRoleManagement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listTenantRoles).mockResolvedValue(roles);
    vi.mocked(listAssignableTenantPermissions).mockResolvedValue(permissionDefinitions);
    vi.mocked(createTenantRole).mockResolvedValue({
      ...roles[1],
      id: "custom-new",
      code: "custom_new_123",
      name: "Reception Facility Desk"
    });
    vi.mocked(updateTenantRole).mockResolvedValue(roles[1]);
    vi.mocked(deactivateTenantRole).mockResolvedValue({ ...roles[1], isActive: false });
    vi.mocked(reactivateTenantRole).mockResolvedValue(roles[1]);
  });

  it("loads role definitions and only the delegated permission catalogue", async () => {
    render(<TenantRoleManagement {...props} />);

    expect(await screen.findByText("Hospital Administrator")).toBeInTheDocument();
    expect(screen.getByText("Facility Viewer")).toBeInTheDocument();
    expect(screen.getByText("System roles are protected and cannot be edited.")).toBeInTheDocument();
    expect(listTenantRoles).toHaveBeenCalledWith(props.baseUrl, props.accessToken, props.tenantId);
    expect(listAssignableTenantPermissions).toHaveBeenCalledWith(props.baseUrl, props.accessToken, props.tenantId);
    expect(screen.queryByText(/inpatient/i)).not.toBeInTheDocument();
  });

  it("creates a custom role using selected grants and a mandatory audit reason", async () => {
    render(<TenantRoleManagement {...props} />);

    fireEvent.click(await screen.findByRole("button", { name: "Create custom role" }));
    fireEvent.change(screen.getByLabelText("Role name *"), { target: { value: "Reception Facility Desk" } });
    fireEvent.change(screen.getByLabelText("Description *"), { target: { value: "Can read and update facility structure." } });
    fireEvent.click(screen.getByLabelText(/View facility structure/));
    fireEvent.click(screen.getByLabelText(/Create and update facilities/));
    fireEvent.change(screen.getByLabelText("Reason for this change *"), {
      target: { value: "Create a scoped facility maintenance role." }
    });
    fireEvent.click(screen.getByRole("button", { name: "Create role" }));

    await waitFor(() => expect(createTenantRole).toHaveBeenCalledWith(
      props.baseUrl,
      props.accessToken,
      props.tenantId,
      {
        name: "Reception Facility Desk",
        description: "Can read and update facility structure.",
        permissionCodes: ["facility.read", "facility.write"],
        reason: "Create a scoped facility maintenance role."
      }
    ));
    expect(await screen.findByText("Custom role created.")).toBeInTheDocument();
    expect(props.onBusyChange).toHaveBeenCalledWith(true);
    expect(props.onBusyChange).toHaveBeenCalledWith(false);
  });

  it("does not offer role-definition changes to a hospital-scoped membership administrator", async () => {
    render(<TenantRoleManagement
      {...props}
      scopes={[{ scopeType: "Hospital", hospitalId: "hospital-1", departmentId: null }]}
    />);

    expect(await screen.findByText("Hospital Administrator")).toBeInTheDocument();
    expect(screen.getByText(/Only a Tenant-scoped administrator can create or change role definitions/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create custom role" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit role" })).not.toBeInTheDocument();
  });
});
