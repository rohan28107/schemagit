import { useState, useEffect } from "react";
import { projectApi } from "./api/projectApi";
import ProjectHeader from "./components/ProjectHeader";
import ProjectInitializer from "./components/ProjectInitializer";
import BranchManager from "./components/BranchManager";
import CommitForm from "./components/CommitForm";
import SchemaExplorer from "./components/SchemaExplorer";
import DiffResults from "./components/DiffResults";

function App() {
  const [project, setProject] = useState(null);
  const [sqlInput, setSqlInput] = useState("");
  const [projectName, setProjectName] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedBranchId, setSelectedBranchId] = useState(null);
  const [compareBranchId, setCompareBranchId] = useState(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [commitSql, setCommitSql] = useState("");
  const [diffResult, setDiffResult] = useState(null);

  useEffect(() => {
    const savedProjectId = localStorage.getItem("schemagit_project_id");
    if (savedProjectId) {
      fetchProject(savedProjectId);
    }
  }, []);

  useEffect(() => {
    if (project && !selectedBranchId && project.branches?.length > 0) {
      setSelectedBranchId(project.branches[0].id);
    }
  }, [project, selectedBranchId]);

  const fetchProject = async (projectId = project?.id) => {
    if (!projectId) return;
    try {
      const data = await projectApi.fetchProject(projectId);
      setProject(data);
    } catch (e) {
      console.error("Failed to fetch project", e);
    }
  };

  useEffect(() => {
    if (project) {
      const interval = setInterval(() => fetchProject(), 5000);
      return () => clearInterval(interval);
    }
  }, [project]);

  const handleImport = async () => {
    if (!projectName || !sqlInput)
      return alert("Please provide project name and SQL");
    setLoading(true);
    try {
      const data = await projectApi.importProject(projectName, sqlInput);
      setProject(data.project);
      localStorage.setItem("schemagit_project_id", data.project.id);
      setSelectedBranchId(data.project.branches?.[0]?.id);
      alert("Project imported successfully!");
    } catch (e) {
      alert(e.message || "Import failed");
    }
    setLoading(false);
  };

  const createBranch = async () => {
    if (!project) return alert("Import a project first");
    const name = prompt("Enter branch name:");
    if (!name) return;

    try {
      await projectApi.createBranch({
        name,
        projectId: project.id,
        sourceBranchId: selectedBranchId,
      });
      alert("Branch created!");
      fetchProject();
    } catch (e) {
      alert(e.message || "Branching failed");
    }
  };

  const handleCommit = async () => {
    if (!commitMessage || !commitSql)
      return alert("Please provide a commit message and SQL");
    if (!selectedBranchId) return alert("Select a branch first");

    setLoading(true);
    try {
      await projectApi.commitChange({
        branchId: selectedBranchId,
        message: commitMessage,
        snapshot: commitSql,
      });
      alert("Change committed successfully!");
      setCommitMessage("");
      setCommitSql("");
      fetchProject();
    } catch (e) {
      alert(e.message || "Commit failed");
    }
    setLoading(false);
  };

  const handleCompare = async () => {
    if (!selectedBranchId || !compareBranchId)
      return alert("Please select two branches to compare");
    if (selectedBranchId === compareBranchId)
      return alert("Please select two different branches");

    setLoading(true);
    try {
      const data = await projectApi.compareBranches(compareBranchId, selectedBranchId);
      setDiffResult(data);
    } catch (e) {
      console.error("Comparison error:", e);
      alert(e.message || "Comparison failed");
    }
    setLoading(false);
  };

  const handleMerge = async () => {
    if (!selectedBranchId || !compareBranchId)
      return alert("Please select two branches to merge");

    if (!window.confirm(`Merge changes from branch ${compareBranchId} into the base branch?`)) {
      return;
    }

    setLoading(true);
    try {
      const data = await projectApi.mergeBranches({
        sourceBranchId: compareBranchId,
        targetBranchId: selectedBranchId,
      });
      alert(data.message);
      fetchProject();
      setCompareBranchId(null);
    } catch (e) {
      alert(e.message || "Merge failed");
    }
    setLoading(false);
  };

  const handleApply = async () => {
    if (!selectedBranchId) return alert("Select a branch first");
    setLoading(true);
    try {
      const data = await projectApi.applySchema(selectedBranchId);
      const stepsSummary = data.details
        .map((d, i) => `${i + 1}. ${d.step.type} on ${d.step.table} (${d.method})`)
        .join("\n");
      alert(`Schema applied successfully!\n\nSteps applied:\n${stepsSummary}`);
    } catch (e) {
      alert(e.message || "Apply failed");
    }
    setLoading(false);
  };

  const handleResetProject = () => {
    if (
      window.confirm(
        "Are you sure you want to switch projects? This will clear the current session.",
      )
    ) {
      localStorage.removeItem("schemagit_project_id");
      setProject(null);
      setSelectedBranchId(null);
      setCompareBranchId(null);
      setDiffResult(null);
    }
  };

  const selectedBranch = project?.branches?.find(
    (b) => b.id === selectedBranchId,
  );
  const schemaContent = selectedBranch?.head?.snapshot?.content || {};

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <ProjectHeader project={project} onResetProject={handleResetProject} />

      {!project ? (
        <ProjectInitializer
          projectName={projectName}
          setProjectName={setProjectName}
          sqlInput={sqlInput}
          setSqlInput={setSqlInput}
          onImport={handleImport}
          loading={loading}
        />
      ) : (
        <main className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 space-y-6">
            <BranchManager
              project={project}
              selectedBranchId={selectedBranchId}
              setSelectedBranchId={setSelectedBranchId}
              compareBranchId={compareBranchId}
              setCompareBranchId={setCompareBranchId}
              onCreateBranch={createBranch}
              onMerge={handleMerge}
              loading={loading}
            />
            <CommitForm
              commitMessage={commitMessage}
              setCommitMessage={setCommitMessage}
              commitSql={commitSql}
              setCommitSql={setCommitSql}
              onCommit={handleCommit}
              loading={loading}
            />
          </div>
          <div className="lg:col-span-2 space-y-6">
            <SchemaExplorer
              schemaContent={schemaContent}
              onCompare={handleCompare}
              onApply={handleApply}
              loading={loading}
            />
            <DiffResults
              diffResult={diffResult}
              onClear={() => setDiffResult(null)}
            />
          </div>
        </main>
      )}
    </div>
  );
}

export default App;
