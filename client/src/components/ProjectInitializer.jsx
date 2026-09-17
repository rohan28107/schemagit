import React from "react";

function ProjectInitializer({ projectName, setProjectName, sqlInput, setSqlInput, onImport, loading }) {
  return (
    <div className="max-w-2xl mx-auto bg-white p-8 rounded-xl shadow-sm border border-gray-200">
      <h2 className="text-2xl font-bold mb-6">Initialize Your Project</h2>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Project Name
          </label>
          <input
            type="text"
            className="w-full p-2 border rounded-md"
            placeholder="e.g. My Awesome App"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            MySQL Dump (SQL)
          </label>
          <textarea
            className="w-full p-2 border rounded-md h-64 font-mono text-sm"
            placeholder="Paste your CREATE TABLE statements here..."
            value={sqlInput}
            onChange={(e) => setSqlInput(e.target.value)}
          />
        </div>
        <button
          onClick={onImport}
          disabled={loading}
          className="w-full py-3 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 transition-colors disabled:bg-blue-300"
        >
          {loading ? "Importing..." : "Initialize Project"}
        </button>
      </div>
    </div>
  );
}

export default ProjectInitializer;
