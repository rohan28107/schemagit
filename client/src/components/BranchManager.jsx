import React from "react";

function BranchManager({
  project,
  selectedBranchId,
  setSelectedBranchId,
  compareBranchId,
  setCompareBranchId,
  onCreateBranch,
  onMerge,
  onExport,
  loading,
}) {
  return (
    <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
      <h2 className="text-xl font-semibold mb-4">Branches</h2>
      <div className="space-y-2">
        {project.branches?.map((b) => (
          <div
            key={b.id}
            className={`flex items-center justify-between p-2 rounded border transition-colors ${selectedBranchId === b.id ? "bg-blue-50 text-blue-700 border-blue-200" : "hover:bg-gray-50 border-gray-100"}`}
          >
            <span
              className={`font-medium cursor-pointer hover:text-blue-600 ${selectedBranchId === b.id ? "text-blue-700" : "text-gray-900"}`}
              onClick={() => setSelectedBranchId(b.id)}
            >
              {b.name}{" "}
              {selectedBranchId === b.id && (
                <span className="text-xs font-normal text-blue-500 ml-2">
                  (Base)
                </span>
              )}
            </span>
            <div className="flex items-center gap-2">
              <label
                className={`flex items-center gap-1 text-xs ${selectedBranchId === b.id ? "text-gray-300 cursor-not-allowed" : "text-gray-500 cursor-pointer"}`}
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  type="checkbox"
                  disabled={selectedBranchId === b.id}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    e.stopPropagation();
                    setCompareBranchId(e.target.checked ? b.id : null);
                  }}
                  checked={compareBranchId === b.id}
                />
                Compare
              </label>
              {b.name === "main" && (
                <span className="text-xs bg-blue-200 px-2 py-1 rounded">
                  Active
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 space-y-2">
        <button
          onClick={onCreateBranch}
          disabled={loading}
          className="w-full py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:bg-blue-300 disabled:cursor-not-allowed"
        >
          {loading ? "Processing..." : "Create Branch"}
        </button>
        {selectedBranchId && (
          <button
            onClick={() => onExport(selectedBranchId)}
            disabled={loading}
            className="w-full py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            {loading ? "Exporting..." : "Export Selected as .sql"}
          </button>
        )}
        {selectedBranchId && compareBranchId && (
          <button
            onClick={onMerge}
            disabled={loading}
            className="w-full py-2 bg-green-600 text-white rounded hover:bg-green-700 transition-colors disabled:bg-green-300 disabled:cursor-not-allowed"
          >
            {loading ? "Merging..." : "Merge Selected into Base"}
          </button>
        )}
      </div>
    </div>
  );
}

export default BranchManager;
