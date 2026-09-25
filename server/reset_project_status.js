const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function resetStatus() {
  const projectId = process.argv[2];
  if (!projectId) {
    console.error('Please provide a project ID: node reset_project_status.js <projectId>');
    process.exit(1);
  }

  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId }
    });

    if (!project) {
      console.error(`Project ${projectId} not found.`);
      process.exit(1);
    }

    console.log(`Current status: ${project.status}`);
    
    await prisma.project.update({
      where: { id: projectId },
      data: { status: 'READY' }
    });

    console.log(`Successfully reset project ${projectId} to READY.`);
  } catch (error) {
    console.error('Error resetting status:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

resetStatus();
