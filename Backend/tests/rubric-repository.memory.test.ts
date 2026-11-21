import { describeRubricRepositoryContract } from './contracts/rubric-repository.contract.js';
import { InMemoryRubricRepository } from './fakes/in-memory-rubric.repository.js';

// Servis testlerinin kullandığı sahte depo, gerçek depoyla aynı sözleşmeye uymalıdır.
describeRubricRepositoryContract('bellek içi', () => new InMemoryRubricRepository());
