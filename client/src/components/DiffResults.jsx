import React from "react";

function DiffResults({ diffResult, onClear }) {
  if (!diffResult) return null;

  const diff = diffResult.diff;
  const hasDiffs = diff &&
    !Object.values(diff).every(arr => !arr || arr.length === 0);

  const renderChange = (type, item) => {
    switch (type) {
      case 'tablesAdded': return <div className="text-green-600 font-medium">+ Table: {item}</div>;
      case 'tablesDropped': return <div className="text-red-600 font-medium">- Table: {item}</div>;
      case 'columnsAdded': return <div className="text-green-600 ml-4"> + Col: {item.column.name} ({item.column.type}) in {item.table}</div>;
      case 'columnsDropped': return <div className="text-red-600 ml-4"> - Col: {item.column} in {item.table}</div>;
      case 'columnsModified': return <div className="text-blue-600 ml-4"> ~ Col: {item.column} in {item.table} ({item.old.type} → {item.new.type})</div>;
      default: return null;
    }
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
      <h2 className="text-xl font-semibold mb-4">
        Comparison Results
      </h2>
      {!hasDiffs ? (
        <div className="p-8 text-center text-gray-500 italic">
          No differences found between the selected branches.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="flex flex-col">
            <h3 className="text-sm font-bold uppercase text-gray-400 mb-2">
              Human Readable Diff
            </h3>
            <div className="p-4 bg-gray-50 rounded-md text-sm space-y-1 border border-gray-200 overflow-auto max-h-[500px]">
              {diff.tablesAdded.map((t, i) => <div key={`ta${i}`}>{renderChange('tablesAdded', t)}</div>)}
              {diff.tablesDropped.map((t, i) => <div key={`td${i}`}>{renderChange('tablesDropped', t)}</div>)}
              {diff.columnsAdded.map((c, i) => <div key={`ca${i}`}>{renderChange('columnsAdded', c)}</div>)}
              {diff.columnsDropped.map((c, i) => <div key={`cd${i}`}>{renderChange('columnsDropped', c)}</div>)}
              {diff.columnsModified.map((c, i) => <div key={`cm${i}`}>{renderChange('columnsModified', c)}</div>)}
            </div>
          </div>
          <div className="flex flex-col">
            <h3 className="text-sm font-bold uppercase text-gray-400 mb-2">
              Preview SQL
            </h3>
            <div className="p-4 bg-gray-900 text-green-400 rounded-md font-mono text-xs whitespace-pre-wrap border border-gray-800 overflow-auto max-h-[500px]">
              {diffResult.ddl || "No DDL generated."}
            </div>
          </div>
        </div>
      )}
      <button
        onClick={onClear}
        className="mt-4 text-sm text-blue-600 hover:underline"
      >
        Clear Comparison
      </button>
    </div>
  );
}

export default DiffResults;
