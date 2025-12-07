# backend

Provolo NodeJS backend

## AI Endpoints

- `POST /api/v1/ai/optimize-upwork` Optimize an Upwork-style freelancer profile
- `POST /api/v1/ai/optimize-linkedin` Optimize a LinkedIn professional profile
- `GET /api/v1/ai/optimizer-history` List profile optimization history (query: page, limit, search, type=upwork|linkedin)
- `GET /api/v1/ai/optimizer-history/:recordId` Retrieve a single optimization record
- `POST /api/v1/ai/generate-proposal` Generate an Upwork proposal
- `GET /api/v1/ai/proposal-history` List proposal history
- `GET /api/v1/ai/proposal-history/:proposalId` Retrieve single proposal + versions
- `POST /api/v1/ai/refine-proposal` Refine existing proposal
- `GET /api/v1/ai/proposal-versions/:proposalId` List all versions of a proposal
- `GET /api/v1/ai/quota` Get quota info for a feature
- `GET /api/v1/ai/cron/cleanup-proposal-history-30d` Delete proposal records older than 30 days
- `GET /api/v1/ai/cron/cleanup-optimizer-history-30d` Delete optimizer history records older than 30 days

### Optimizer History

Each optimization (Upwork or LinkedIn) is stored automatically after a successful response.

Record structure:

```
id: string
userId: string
optimizerType: "upwork" | "linkedin"
originalInput: {
  fullName?: string
  professionalTitle?: string
  content: string
} (structured submitted profile input)
response: {
	weaknessesAndOptimization: string
	optimizedProfileOverview: string
	suggestedProjectTitles: string
	recommendedVisuals: string
	beforeAfterComparison: string
}
createdAt: Date
updatedAt: Date
```

List endpoint supports optional `search` (matches originalInput + optimizedProfileOverview + weaknessesAndOptimization) and `type` filter.
