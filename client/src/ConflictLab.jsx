import React, { useState } from 'react';

function ConflictLab() {
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState('Ready to simulate conflict');

  const simulate = async () => {
    try {
      if (step === 0) {
        setStatus('Creating Branch A: Renaming email -> contact_email...');
        // Mock API call
        setStep(1);
        setTimeout(() => setStatus('Branch A committed.'), 1000);
      } else if (step === 1) {
        setStatus('Creating Branch B: Changing email to VARCHAR(500)...');
        // Mock API call
        setStep(2);
        setTimeout(() => setStatus('Branch B committed.'), 1000);
      } else if (step === 2) {
        setStatus('Attempting to Merge Branch B into Branch A...');
        setStep(3);
        setTimeout(() => setStatus('CONFLICT DETECTED: users.email modified in B but renamed in A.'), 1000);
      } else {
        setStep(0);
        setStatus('Ready to simulate conflict');
      }
    } catch (e) {
      setStatus('Error during simulation');
    }
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 mt-8">
      <h2 className="text-xl font-semibold mb-4 text-red-600">Conflict Lab 🧪</h2>
      <p className="text-gray-600 mb-6">
        Simulate a complex schema conflict to test the merge engine's resolution capabilities.
      </p>

      <div className="flex items-center gap-4 mb-6">
        <div className={`flex-1 p-4 rounded-md border ${step >= 1 ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
          <span className="block text-xs font-bold uppercase text-gray-400">Branch A</span>
          <span className="text-sm font-medium">Rename email $\rightarrow$ contact_email</span>
        </div>
        <div className="text-xl font-bold text-gray-300">→</div>
        <div className={`flex-1 p-4 rounded-md border ${step >= 2 ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
          <span className="block text-xs font-bold uppercase text-gray-400">Branch B</span>
          <span className="text-sm font-medium">Modify email to VARCHAR(500)</span>
        </div>
      </div>

      <div className={`p-4 rounded-md mb-6 text-center font-medium ${step === 3 ? 'bg-red-100 text-red-700 border border-red-200' : 'bg-gray-100 text-gray-700'}`}>
        {status}
      </div>

      <button
        onClick={simulate}
        className="w-full py-3 bg-red-600 text-white rounded-lg font-bold hover:bg-red-700 transition-colors shadow-md"
      >
        {step === 0 ? 'Start Simulation' : step === 3 ? 'Reset' : 'Next Step'}
      </button>
    </div>
  );
}

export default ConflictLab;