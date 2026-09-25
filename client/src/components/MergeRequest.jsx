import React, { useEffect, useState } from 'react';
import { CheckCircle, XCircle, AlertCircle, Plus, Minus, RefreshCw } from 'lucide-react';

const MergeRequest = ({ sourceBranch, targetBranch, onConfirm, onCancel, projectApi }) => {
  const [diffResult, setDiffResult] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDiff = async () => {
      try {
        const data = await projectApi.compareBranches(
          sourceBranch.id,
          targetBranch.id
        );
        setDiffResult(data);
      } catch (e) {
        console.error("Failed to fetch merge diff", e);
      } finally {
        setLoading(false);
      }
    };
    fetchDiff();
  }, [sourceBranch, targetBranch, projectApi]);

  const ChangeItem = ({ type, item }) => {
    switch (type) {
      case 'tablesAdded':
        return (
          <div className="flex items-center p-2 bg-green-50 border-l-4 border-green-500 rounded mb-2 text-green-700">
            <Plus className="w-4 h-4 mr-2" />
            <span className="font-medium">Table added: {item}</span>
          </div>
        );
      case 'tablesDropped':
        return (
          <div className="flex items-center p-2 bg-red-50 border-l-4 border-red-500 rounded mb-2 text-red-700">
            <Minus className="w-4 h-4 mr-2" />
            <span className="font-medium">Table dropped: {item}</span>
          </div>
        );
      case 'columnsAdded':
        return (
          <div className="flex items-center p-2 bg-green-50 border-l-4 border-green-400 rounded mb-2 text-green-700 ml-4 text-sm">
            <Plus className="w-3 h-3 mr-2" />
            <span>Col: <span className="font-semibold">{item.column?.name}</span> ({item.column?.type}) in {item.table}</span>
          </div>
        );
      case 'columnsDropped':
        return (
          <div className="flex items-center p-2 bg-red-50 border-l-4 border-red-400 rounded mb-2 text-red-700 ml-4 text-sm">
            <Minus className="w-3 h-3 mr-2" />
            <span>Col: <span className="font-semibold">{item.column}</span> in {item.table}</span>
          </div>
        );
      case 'columnsModified':
        return (
          <div className="flex items-center p-2 bg-blue-50 border-l-4 border-blue-400 rounded mb-2 text-blue-700 ml-4 text-sm">
            <RefreshCw className="w-3 h-3 mr-2" />
            <span>Col: <span className="font-semibold">{item.column}</span> in {item.table} ({item.old?.type} → {item.new?.type})</span>
          </div>
        );
      default: return null;
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b bg-gray-50 flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-gray-800">Merge Request</h2>
            <p className="text-gray-600 mt-1">
              Merging <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-sm font-semibold">{sourceBranch.name}</span>
              <span className="mx-2 text-gray-400">→</span>
              <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-sm font-semibold">{targetBranch.name}</span>
            </p>
          </div>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 transition-colors">
            <XCircle className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-white">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-64 text-gray-500">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-4"></div>
              <p>Analyzing schema differences...</p>
            </div>
          ) : !diffResult || (
            !Object.values(diffResult.diff).every(arr => !arr || arr.length === 0) === false
          ) ? (
            <div className="p-20 text-center space-y-4">
              <CheckCircle className="w-12 h-12 text-green-500 mx-auto" />
              <p className="text-xl text-gray-600 font-medium">No differences found</p>
              <p className="text-gray-400">The branches are already in sync.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="flex flex-col space-y-4">
                <div className="flex items-center space-x-2 text-gray-800 font-bold uppercase text-xs tracking-wider">
                  <AlertCircle className="w-4 h-4 text-blue-500" />
                  <span>Proposed Changes</span>
                </div>
                <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 overflow-y-auto max-h-[60vh] space-y-2">
                  {diffResult.diff.tablesAdded.map((t, i) => <div key={`ta${i}`}><ChangeItem type="tablesAdded" item={t} /></div>)}
                  {diffResult.diff.tablesDropped.map((t, i) => <div key={`td${i}`}><ChangeItem type="tablesDropped" item={t} /></div>)}
                  {diffResult.diff.columnsAdded.map((c, i) => <div key={`ca${i}`}><ChangeItem type="columnsAdded" item={c} /></div>)}
                  {diffResult.diff.columnsDropped.map((c, i) => <div key={`cd${i}`}><ChangeItem type="columnsDropped" item={c} /></div>)}
                  {diffResult.diff.columnsModified.map((c, i) => <div key={`cm${i}`}><ChangeItem type="columnsModified" item={c} /></div>)}
                </div>
              </div>
              <div className="flex flex-col space-y-4">
                <div className="flex items-center space-x-2 text-gray-800 font-bold uppercase text-xs tracking-wider">
                  <RefreshCw className="w-4 h-4 text-blue-500" />
                  <span>SQL Preview</span>
                </div>
                <div className="p-4 bg-slate-900 text-blue-300 rounded-xl font-mono text-xs whitespace-pre-wrap border border-slate-800 overflow-y-auto max-h-[60vh] shadow-inner">
                  {diffResult.ddl || "-- No DDL generated."}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="p-6 border-t bg-gray-50 flex justify-end space-x-4">
          <button
            onClick={onCancel}
            className="px-6 py-2 text-gray-600 hover:text-gray-800 font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading || !diffResult || Object.values(diffResult.diff).every(arr => !arr || arr.length === 0)}
            className="px-8 py-2 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 transition-all shadow-lg disabled:bg-blue-300 disabled:shadow-none active:scale-95"
          >
            Confirm Merge
          </button>
        </div>
      </div>
    </div>
  );
};

export default MergeRequest;
