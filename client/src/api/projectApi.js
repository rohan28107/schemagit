const BASE_URL = import.meta.env.VITE_API_BASE_URL;

export const projectApi = {
  async importProject(name, sql, file, connectionString) {
    const formData = new FormData();
    formData.append("name", name);
    formData.append("connectionString", connectionString);
    if (file) {
      formData.append("sqlFile", file);
    } else if (sql) {
      formData.append("sql", sql);
    }

    const res = await fetch(`${BASE_URL}/import`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) throw new Error("Import failed");
    return res.json();
  },

  async exportSchema(branchId) {
    const res = await fetch(`${BASE_URL}/export?branchId=${branchId}`);
    if (!res.ok) throw new Error("Export failed");
    return res.blob();
  },

  async fetchProject(projectId) {
    const res = await fetch(`${BASE_URL}/${projectId}`);
    if (!res.ok) throw new Error("Failed to fetch project");
    return res.json();
  },

  async createBranch({ name, projectId, sourceBranchId }) {
    const res = await fetch(`${BASE_URL}/branch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, projectId, sourceBranchId }),
    });
    if (!res.ok) throw new Error("Branching failed");
    return res.json();
  },

  async commitChange({ branchId, message, snapshot }) {
    const res = await fetch(`${BASE_URL}/commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branchId, message, snapshot }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Commit failed");
    }
    return res.json();
  },

  async compareBranches(branchA, branchB) {
    const res = await fetch(
      `${BASE_URL}/diff?branchA=${branchA}&branchB=${branchB}&t=${Date.now()}`,
    );
    if (!res.ok) throw new Error("Comparison failed");
    return res.json();
  },

  async applySchema(branchId) {
    const res = await fetch(`${BASE_URL}/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branchId }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Apply failed");
    }
    return res.json();
  },

  async mergeBranches({ sourceBranchId, targetBranchId }) {
    const res = await fetch(`${BASE_URL}/merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceBranchId, targetBranchId }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw {
        response: {
          status: res.status,
          data: data,
        },
        message: data.error || "Merge failed",
      };
    }
    return res.json();
  },

  async resolveConflicts({ sourceBranchId, targetBranchId, resolutions }) {
    const res = await fetch(`${BASE_URL}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceBranchId, targetBranchId, resolutions }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Failed to resolve conflicts");
    }
    return res.json();
  },
};
