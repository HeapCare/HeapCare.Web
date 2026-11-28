import { describe, expect, it } from "vitest";
import {
  getCanonicalWorkspaceLocation,
  getRequestedWorkspaceSection,
  isWorkspaceSectionActive
} from "./workspaceRoutes";

describe("route-level workspace navigation", () => {
  it("resolves stable module paths and legacy hash links", () => {
    expect(getRequestedWorkspaceSection("/billing", "#billing")).toBe("billing");
    expect(getRequestedWorkspaceSection("/", "#clinical")).toBe("clinical");
    expect(getRequestedWorkspaceSection("/appointment-management", "")).toBe("appointment-management");
    expect(getRequestedWorkspaceSection("/roles", "#roles")).toBe("roles");
  });

  it("preserves non-module anchors while canonicalizing legacy module hashes", () => {
    expect(getCanonicalWorkspaceLocation("billing", "#billing", true)).toBe("/billing#billing");
    expect(getCanonicalWorkspaceLocation("billing", "#workspace-main", false)).toBe("/billing#workspace-main");
    expect(getCanonicalWorkspaceLocation("", "#workspace-main", false)).toBe("/#workspace-main");
    expect(getCanonicalWorkspaceLocation("", "#reception", true)).toBe("/");
  });

  it("keeps route visibility tied to the active authorized workspace", () => {
    expect(isWorkspaceSectionActive("clinical", "clinical")).toBe(true);
    expect(isWorkspaceSectionActive("clinical", "billing")).toBe(false);
  });
});
