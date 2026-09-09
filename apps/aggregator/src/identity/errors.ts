export class EmployerIdentityReviewRequired extends Error {
  constructor(public readonly sourceKey: string, public readonly externalId: string, public readonly rawEmployerName: string, public readonly proposedName: string) {
    super(`Employer identity needs evidence: source=${sourceKey} externalId=${externalId} raw=${JSON.stringify(rawEmployerName)} proposed=${JSON.stringify(proposedName)}`);
    this.name = 'EmployerIdentityReviewRequired';
  }
}
