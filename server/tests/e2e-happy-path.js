const axios = require('axios');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const API_BASE = 'http://localhost:3001/api/projects';
const axiosInstance = axios.create({
  baseURL: API_BASE,
  validateStatus: () => true, // Handle errors manually
});

async function runStep(name, fn) {
  console.log(`\x1b[34m[Step]\x1b[0m ${name}...`);
  try {
    const result = await fn();
    console.log(`\x1b[32m✓\x1b[0m ${name} completed.`);
    return result;
  } catch (e) {
    console.error(`\x1b[31m✗\x1b[0m ${name} failed: ${e.message}`);
    process.exit(1);
  }
}

async function main() {
  console.log('\x1b[1mStarting End-to-End Happy Path Verification\x1b[0m\n');

  // 1. Import Baseline Schema
  const baselineSql = `
    CREATE TABLE users (
      id VARCHAR(36) PRIMARY KEY,
      username TEXT NOT NULL,
      email TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE profiles (
      user_id VARCHAR(36) PRIMARY KEY,
      bio TEXT,
      avatar_url TEXT
    );
  `;

  const project = await runStep('Import Baseline Schema', async () => {
    const res = await axiosInstance.post('/import', {
      name: 'E2E-Test-Project',
      sql: baselineSql,
    });
    if (res.status !== 200) {
      console.error('Import Response Data:', JSON.stringify(res.data, null, 2));
      throw new Error(res.data.error || 'Import failed');
    }
    return res.data.project;
  });

  const projectId = project.id;

  // 2. Branching
  const mainBranch = project.branches.find(b => b.name === 'main');
  const branchA = await runStep('Create feature/A branch', async () => {
    const res = await axiosInstance.post('/branch', {
      name: 'feature/A',
      projectId,
      sourceBranchId: mainBranch.id,
    });
    return res.data;
  });

  const branchB = await runStep('Create feature/B branch', async () => {
    const res = await axiosInstance.post('/branch', {
      name: 'feature/B',
      projectId,
      sourceBranchId: mainBranch.id,
    });
    return res.data;
  });

  // 3. Divergence
  await runStep('Commit conflicting change to feature/A (Modify Column)', async () => {
    // Use a full CREATE TABLE statement for the snapshot since SQLParser.parse expects full table definitions
    const sql = `
      CREATE TABLE users (
        id VARCHAR(36) PRIMARY KEY,
        username VARCHAR(255) NOT NULL,
        email TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE profiles (
        user_id VARCHAR(36) PRIMARY KEY,
        bio TEXT,
        avatar_url TEXT
      );
    `;
    const res = await axiosInstance.post('/commit', {
      branchId: branchA.id,
      message: 'Modify username to 255',
      snapshot: sql,
    });
    if (res.status !== 200) throw new Error(res.data.error);
  });

  await runStep('Commit conflicting change to feature/B (Modify Column)', async () => {
    const sql = `
      CREATE TABLE users (
        id VARCHAR(36) PRIMARY KEY,
        username VARCHAR(100) NOT NULL,
        email TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE profiles (
        user_id VARCHAR(36) PRIMARY KEY,
        bio TEXT,
        avatar_url TEXT
      );
    `;
    const res = await axiosInstance.post('/commit', {
      branchId: branchB.id,
      message: 'Modify username to 100',
      snapshot: sql,
    });
    if (res.status !== 200) throw new Error(res.data.error);
  });

  // 4. Merge Happy Path (A -> Main)
  await runStep('Merge feature/A into main (No conflicts)', async () => {
    const res = await axiosInstance.post('/merge', {
      sourceBranchId: branchA.id,
      targetBranchId: mainBranch.id,
    });
    if (res.status !== 200) throw new Error(res.data.error);
  });

  // 5. Merge Conflict Path (B -> Main)
  const conflictData = await runStep('Attempt merge feature/B into main (Should conflict)', async () => {
    const res = await axiosInstance.post('/merge', {
      sourceBranchId: branchB.id,
      targetBranchId: mainBranch.id,
    });
    if (res.status !== 409) throw new Error('Expected 409 Conflict, got ' + res.status);
    return res.data;
  });

  await runStep('Resolve conflicts for feature/B', async () => {
    // We pick Branch B's version (the modification) for all conflicts
    const resolutions = {};
    conflictData.conflicts.forEach((c, i) => {
      resolutions[i] = c.valueB;
    });

    const res = await axiosInstance.post('/resolve', {
      sourceBranchId: branchB.id,
      targetBranchId: mainBranch.id,
      resolutions,
    });
    if (res.status !== 200) throw new Error(res.data.error);
  });

  // 6. Apply and Verify
  await runStep('Apply final schema to DB', async () => {
    const res = await axiosInstance.post('/apply', {
      branchId: mainBranch.id,
    });
    if (res.status !== 200) throw new Error(res.data.error);
  });

  console.log('\n\x1b[32m\x1b[1mAll E2E Happy Path steps passed successfully!\x1b[0m');
}

main().catch(e => {
  console.error('\n\x1b[31mE2E Test Failed:\x1b[0m', e);
  process.exit(1);
});
