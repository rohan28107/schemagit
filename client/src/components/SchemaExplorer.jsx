import React from "react";

function SchemaExplorer({ schemaContent, onCompare, onApply, loading }) {
  return (
    <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold">Schema Explorer</h2>
        <div className="flex gap-4">
          <button
            onClick={onCompare}
            className="px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-900 transition-colors text-sm"
          >
            Compare Branches
          </button>
          <button
            onClick={onApply}
            disabled={loading}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition-colors font-bold text-sm disabled:bg-green-300"
          >
            {loading ? "Applying..." : "Apply to Database"}
          </button>
        </div>
      </div>
      <div className="border rounded-md overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="p-3 font-medium text-gray-600">Table</th>
              <th className="p-3 font-medium text-gray-600">Column</th>
              <th className="p-3 font-medium text-gray-600">Type</th>
              <th className="p-3 font-medium text-gray-600">Constraints</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {Object.entries(schemaContent).length === 0 ? (
              <tr>
                <td colSpan="4" className="p-8 text-center text-gray-500">
                  No tables found in this branch's head.
                </td>
              </tr>
            ) : (
              Object.entries(schemaContent).flatMap(([tableName, tableData]) =>
                (tableData?.columns || []).map((col, idx) => (
                  <tr key={`${tableName}-${idx}`} className="hover:bg-gray-50">
                    <td className="p-3 font-medium">{tableName}</td>
                    <td className="p-3">{col.name}</td>
                    <td className="p-3 text-gray-500">{col.type}</td>
                    <td className="p-3 text-xs text-gray-400">
                      {col.primaryKey ? "PK " : ""}
                      {col.autoIncrement ? "AI " : ""}
                      {col.nullable ? "" : "NOT NULL "}
                    </td>
                  </tr>
                )),
              )
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default SchemaExplorer;
