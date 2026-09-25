import React from 'react';

const STATUS_CONFIG = {
  PROVISIONING: {
    label: 'Provisioning',
    message: 'Creating your dedicated TiDB database instance...',
    color: 'bg-blue-100 text-blue-700 border-blue-200',
    icon: '⚙️'
  },
  IMPORTING: {
    label: 'Importing',
    message: 'Executing SQL dump and initializing schema...',
    color: 'bg-indigo-100 text-indigo-700 border-indigo-200',
    icon: '📥'
  },
  VERIFYING: {
    label: 'Verifying',
    message: 'Comparing physical database state against metadata...',
    color: 'bg-yellow-100 text-yellow-700 border-yellow-200',
    icon: '🔍'
  },
  FAILED: {
    label: 'Failed',
    message: 'An error occurred during the process. Please try importing again.',
    color: 'bg-red-100 text-red-700 border-red-200',
    icon: '❌'
  },
  READY: {
    label: 'Ready',
    message: 'Project is fully initialized and ready for use.',
    color: 'bg-green-100 text-green-700 border-green-200',
    icon: '✅'
  }
};

const ProjectStatusBanner = ({ status }) => {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.READY;

  return (
    <div className={`w-full p-3 border-b flex items-center justify-center gap-3 transition-all animate-in fade-in slide-in-from-top-2 ${config.color}`}>
      <span className="text-lg">{config.icon}</span>
      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
        <span className="font-bold text-sm uppercase tracking-wider">{config.label}</span>
        <span className="text-sm opacity-90">{config.message}</span>
      </div>
    </div>
  );
};

export default ProjectStatusBanner;
