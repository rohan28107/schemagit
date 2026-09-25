import React, { useState } from "react";

function ProjectInitializer({ projectName, setProjectName, connectionString, setConnectionString, sqlInput, setSqlInput, onImport, loading }) {
  const [file, setFile] = useState(null);
  const [importMode, setImportMode] = useState("text"); // 'text' or 'file'

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      setFile(selectedFile);
    }
  };

  return (
    <div className="max-w-2xl mx-auto bg-white p-8 rounded-xl shadow-sm border border-gray-200">
      <h2 className="text-2xl font-bold mb-6">Initialize Your Project</h2>
      <div className="space-y-4">
        <div className="flex items-center gap-4 mb-4">
          <button
            onClick={() => setImportMode("text")}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${importMode === "text" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
          >
            Paste SQL
          </button>
          <button
            onClick={() => setImportMode("file")}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${importMode === "file" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
          >
            Upload .sql File
          </button>
        </div>

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

          <div className="space-y-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Connection String <span className="text-gray-400 font-normal">(Optional)</span>
            </label>
            <input
              type="text"
              className="w-full p-2 border rounded-md font-mono text-sm"
              placeholder="mysql://user:pass@host:port/db_name"
              value={connectionString}
              onChange={(e) => setConnectionString(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {importMode === "text" ? "MySQL Dump (SQL)" : "SQL Dump File"}
            </label>
            {importMode === "text" ? (
              <textarea
                className="w-full p-2 border rounded-md h-64 font-mono text-sm"
                placeholder="Paste your CREATE TABLE statements here..."
                value={sqlInput}
                onChange={(e) => setSqlInput(e.target.value)}
              />
            ) : (
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-400 transition-colors cursor-pointer relative">
                <input
                  type="file"
                  accept=".sql"
                  onChange={handleFileChange}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                />
                <div className="text-gray-500">
                  {file ? (
                    <span className="text-blue-600 font-medium">{file.name}</span>
                  ) : (
                    "Click or drag and drop your .sql file here"
                  )}
                </div>
              </div>
            )}
          </div>

          <button
            onClick={() => onImport(file)}
            disabled={loading}
            className="w-full py-3 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 transition-colors disabled:bg-blue-300"
          >
            {loading ? "Importing..." : "Initialize Project"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ProjectInitializer;
