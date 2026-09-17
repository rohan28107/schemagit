import React from "react";

function ProjectHeader({ project, onResetProject }) {
  return (
    <header className="mb-8 flex justify-between items-center">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">SchemaGit</h1>
        <p className="text-gray-600">
          Version control for your database schemas
        </p>
      </div>
      {project && (
        <div className="flex items-center gap-4 text-right">
          <button
            onClick={onResetProject}
            className="px-3 py-1 text-xs font-medium text-red-600 border border-red-200 rounded hover:bg-red-50 transition-colors"
          >
            Switch Project
          </button>
          <div>
            <span className="text-sm font-medium text-gray-500">
              Active Project:
            </span>
            <div className="text-lg font-bold text-blue-600">
              {project.name}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}

export default ProjectHeader;
