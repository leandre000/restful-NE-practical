const fs = require('fs');
const yaml = require('yamljs');
const path = '../swagger.yaml';
let doc = yaml.load(path);

if (doc.paths['/auth/register'] && doc.paths['/auth/register'].post) {
  doc.paths['/auth/register'].post.requestBody = {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            firstName: { type: 'string', example: 'Admin' },
            lastName: { type: 'string', example: 'User' },
            email: { type: 'string', example: 'admin@femcs.rw' },
            password: { type: 'string', example: 'Admin@1234' },
            role: { type: 'string', example: 'admin' }
          }
        }
      }
    }
  };
}

if (doc.paths['/inspections'] && doc.paths['/inspections'].post) {
  doc.paths['/inspections'].post.requestBody = {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            extinguisherId: { type: 'integer', example: 1 },
            inspectorId: { type: 'integer', example: 1 },
            status: { type: 'string', example: 'passed' },
            notes: { type: 'string', example: 'Passed inspection.' }
          }
        }
      }
    }
  };
}

if (doc.paths['/maintenance'] && doc.paths['/maintenance'].post) {
  doc.paths['/maintenance'].post.requestBody = {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            extinguisherId: { type: 'integer', example: 1 },
            actionTaken: { type: 'string', example: 'Refilled' },
            performedBy: { type: 'integer', example: 1 },
            cost: { type: 'number', example: 50.0 }
          }
        }
      }
    }
  };
}

// Add parameters to any remaining GET methods that don't have them
for (const url in doc.paths) {
  const methods = doc.paths[url];
  if (methods.get && !methods.get.parameters) {
    methods.get.parameters = [
      { in: 'query', name: 'page', schema: { type: 'integer', default: 1 }, description: 'Page number' },
      { in: 'query', name: 'limit', schema: { type: 'integer', default: 10 }, description: 'Number of items' }
    ];
  }
}

const newYaml = yaml.stringify(doc, 6, 2);
fs.writeFileSync(path, newYaml);
console.log('Swagger completely updated!');
