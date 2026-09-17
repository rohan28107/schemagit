import React from "react";

function CommitForm({
  commitMessage,
  setCommitMessage,
  commitSql,
  setCommitSql,
  onCommit,
  loading,
}) {
  return (
    <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
      <h2 className="text-xl font-semibold mb-4">Commit Change</h2>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Commit Message
          </label>
          <input
            type="text"
            className="w-full p-2 border rounded-md text-sm"
            placeholder="e.g. Add users table"
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            New Schema (SQL)
          </label>
          <textarea
            className="w-full p-2 border rounded-md h-32 font-mono text-xs"
            placeholder="Paste updated CREATE TABLE statements..."
            value={commitSql}
            onChange={(e) => setCommitSql(e.target.value)}
          />
        </div>
        <button
          onClick={onCommit}
          disabled={loading}
          className="w-full py-2 bg-green-600 text-white rounded font-bold hover:bg-green-700 transition-colors disabled:bg-green-300"
        >
          {loading ? "Committing..." : "Commit to Branch"}
        </button>
      </div>
    </div>
  );
}

export default CommitForm;
