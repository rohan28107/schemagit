import React, { useState } from 'react';
import { CheckCircle, XCircle, AlertCircle, Plus, Minus, RefreshCw, UserCheck, FileJson } from 'lucide-react';

const ConflictResolver = ({ conflicts, onResolve, onCancel }) => {
  const [resolvedConflicts, setResolvedConflicts] = useState({});
  const [manualValue, setManualValue] = useState({});

  const handlePick = (conflictId, value) => {
    setResolvedConflicts(prev => ({
      ...prev,
      [conflictId]: value
    }));
    setManualValue(prev => {
      const next = { ...prev };
      delete next[conflictId];
      return next;
    });
  };

  const handleManualEdit = (conflictId, value) => {
    setManualValue(prev => ({
      ...prev,
      [conflictId]: value
    }));
    setResolvedConflicts(prev => ({
      ...prev,
      [conflictId]: 'MANUAL'
    }));
  };

  const handleResolve = () => {
    if (Object.keys(resolvedConflicts).length !== conflicts.length) {
      alert('Please resolve all conflicts before proceeding.');
      return;
    }

    const finalResolutions = {};
    conflicts.forEach((_, index) => {
      const choice = resolvedConflicts[index];
      if (choice === 'A') {
        finalResolutions[index] = conflicts[index].valueA;
      } else if (choice === 'B') {
        finalResolutions[index] = conflicts[index].valueB;
      } else if (choice === 'MANUAL') {
        finalResolutions[index] = manualValue[index];
      }
    });

    onResolve(finalResolutions);
  };

  const resolutionProgress = (Object.keys(resolvedConflicts).length / conflicts.length) * 100;

  const renderFormattedValue = (val) => {
    if (val === null || val === undefined) return <span className="text-gray-400 italic">null</span>;

    if (typeof val === 'object') {
      return (
        <pre className="text-left font-mono text-[11px] leading-relaxed overflow-x-auto custom-scrollbar">
          <code className="text-gray-800 whitespace-pre-wrap break-all">
            {JSON.stringify(val, null, 2)}
          </code>
        </pre>
      );
    }

    return <span className="break-words">{String(val)}</span>;
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b bg-gray-50 flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-gray-800">Resolve Merge Conflicts</h2>
            <p className="text-gray-600 mt-1">
              Both branches modified the same database element. Choose the correct version to finalize the merge.
            </p>
          </div>
          <div className="text-right">
            <div className="text-xs font-bold text-gray-400 uppercase mb-1">Progress</div>
            <div className="flex items-center space-x-2">
              <div className="w-32 h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-600 transition-all duration-300"
                  style={{ width: `${resolutionProgress}%` }}
                />
              </div>
              <span className="text-sm font-bold text-indigo-600">{Math.round(resolutionProgress)}%</span>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-white">
          {conflicts.map((conflict, index) => {
            const isResolved = resolvedConflicts[index] !== undefined;
            return (
              <div
                key={index}
                className={`border rounded-xl p-5 transition-all duration-200 shadow-sm ${
                  isResolved ? 'bg-green-50/30 border-green-200' : 'bg-white border-gray-200 border-l-4 border-l-red-500'
                }`}
              >
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center space-x-3">
                    {isResolved ? (
                      <CheckCircle className="w-5 h-5 text-green-500" />
                    ) : (
                      <AlertCircle className="w-5 h-5 text-red-500" />
                    )}
                    <div>
                      <span className="text-xs font-bold uppercase tracking-wider text-gray-400">{conflict.type}</span>
                      <h3 className="text-lg font-bold text-gray-900">
                        {conflict.table} <span className="text-gray-300 mx-1">›</span> {conflict.column || 'Table'}
                      </h3>
                    </div>
                  </div>
                  <div className={`px-2 py-1 rounded text-xs font-bold ${
                    isResolved ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                  }`}>
                    {isResolved ? 'RESOLVED' : 'CONFLICT'}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                    <div className="flex items-center space-x-2 mb-3 text-gray-500">
                      <span className="text-xs font-bold uppercase tracking-tight">Base Version</span>
                    </div>
                    <div className="bg-white p-3 rounded border border-gray-200 text-sm">
                      {renderFormattedValue(conflict.baseValue)}
                    </div>
                  </div>

                  <div
                    className={`p-4 rounded-lg border transition-all cursor-pointer group ${
                      resolvedConflicts[index] === 'A'
                        ? 'bg-blue-50 border-blue-500 ring-2 ring-blue-100 shadow-sm'
                        : 'bg-white hover:bg-blue-50 border-gray-200'
                    }`}
                    onClick={() => handlePick(index, 'A')}
                  >
                    <div className="flex justify-between items-center mb-3">
                      <span className="text-xs font-bold text-blue-600 uppercase tracking-tight">Source (Branch A)</span>
                      {resolvedConflicts[index] === 'A' && <CheckCircle className="w-4 h-4 text-blue-600" />}
                    </div>
                    <div className="bg-white p-3 rounded border border-gray-200 text-sm mb-3">
                      {renderFormattedValue(conflict.valueA)}
                    </div>
                    <button className={`w-full py-1.5 rounded text-xs font-bold transition-colors ${
                      resolvedConflicts[index] === 'A' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 group-hover:bg-blue-600 group-hover:text-white'
                    }`}>
                      Pick Source
                    </button>
                  </div>

                  <div
                    className={`p-4 rounded-lg border transition-all cursor-pointer group ${
                      resolvedConflicts[index] === 'B'
                        ? 'bg-green-50 border-green-500 ring-2 ring-green-100 shadow-sm'
                        : 'bg-white hover:bg-green-50 border-gray-200'
                    }`}
                    onClick={() => handlePick(index, 'B')}
                  >
                    <div className="flex justify-between items-center mb-3">
                      <span className="text-xs font-bold text-green-600 uppercase tracking-tight">Target (Branch B)</span>
                      {resolvedConflicts[index] === 'B' && <CheckCircle className="w-4 h-4 text-green-600" />}
                    </div>
                    <div className="bg-white p-3 rounded border border-gray-200 text-sm mb-3">
                      {renderFormattedValue(conflict.valueB)}
                    </div>
                    <button className={`w-full py-1.5 rounded text-xs font-bold transition-colors ${
                      resolvedConflicts[index] === 'B' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600 group-hover:bg-green-600 group-hover:text-white'
                    }`}>
                      Pick Target
                    </button>
                  </div>
                </div>

                <div className="mt-6 p-4 bg-slate-50 rounded-xl border border-dashed border-slate-300">
                  <div className="flex items-center space-x-2 mb-3 text-slate-600">
                    <FileJson className="w-4 h-4" />
                    <label className="text-xs font-bold uppercase tracking-wider">Custom JSON Resolution</label>
                  </div>
                  <textarea
                    className="w-full h-24 p-3 text-xs font-mono border rounded-lg bg-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    value={manualValue[index] ? JSON.stringify(manualValue[index], null, 2) : ''}
                    onChange={(e) => {
                      try {
                        const parsed = JSON.parse(e.target.value);
                        handleManualEdit(index, parsed);
                      } catch (e) {}
                    }}
                    placeholder='{ "name": "my_column", "type": "TEXT", "nullable": false }'
                  />
                  <div className="flex justify-between items-center mt-3">
                    <span className={`text-xs transition-colors ${resolvedConflicts[index] === 'MANUAL' ? 'text-indigo-600 font-bold' : 'text-gray-400'}`} >
                      {resolvedConflicts[index] === 'MANUAL' ? '✓ Custom resolution active' : 'Type valid JSON to override both branches'}
                    </span>
                    <button
                      onClick={() => {
                        const current = resolvedConflicts[index] === 'A' ? conflict.valueA :
                                     resolvedConflicts[index] === 'B' ? conflict.valueB :
                                     conflict.baseValue;
                        setManualValue(prev => ({ ...prev, [index]: current }));
                        handleManualEdit(index, current);
                      }}
                      className="text-xs text-indigo-600 hover:text-indigo-800 underline font-medium"
                    >
                      Initialize from current
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="p-6 border-t bg-gray-50 flex justify-end space-x-4">
          <button
            onClick={onCancel}
            className="px-6 py-2 text-gray-600 hover:text-gray-800 font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleResolve}
            disabled={Object.keys(resolvedConflicts).length !== conflicts.length}
            className="px-8 py-2 bg-indigo-600 text-white rounded-lg font-bold hover:bg-indigo-700 transition-all shadow-lg disabled:bg-gray-300 disabled:shadow-none active:scale-95"
          >
            Complete Merge
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConflictResolver;
