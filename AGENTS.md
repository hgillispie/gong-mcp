# Gong MCP — Agent Usage Guide

Notes for LLMs consuming this MCP server's tools.

## Common query patterns

### "Help me prep for my call with [Account]"
1. `search_calls` with the account name — returns briefs, participants, and metadata for all matching calls
2. `get_call_details` with ALL returned call IDs — key points and outlines contain specific discussion details, open questions, and decisions across meetings
3. Synthesize across calls: identify recurring participants, unresolved topics, and the narrative arc of the deal

### "How is [Person] performing?"
1. `search_users` to get their user ID
2. `get_interaction_stats` and `get_aggregate_activity` for the relevant date range
3. `search_calls` with their name to see recent call activity and accounts

### "How did last week's calls go?" (broad time-range queries)
1. `search_calls` with a date range and no query — results may be truncated (check the `truncated` field)
2. If truncated, tell the user how many total matches exist and offer to narrow by account, person, or topic

## Known limitations

### Role and team identification
Most Gong users do not have a job title set. If the user asks about a role or team (e.g. "the SE team", "all AEs", "our SDRs"), do NOT guess — ask the user to name the specific people. Only ~5% of users have titles populated.

### Deep search coverage
When a search term isn't found in call titles, the tool falls back to searching participant names, emails, and company names. This searches calls newest-first but is limited to the calls collected during the title scan phase. For very large time ranges, some older calls may not be checked.

### Gong attendance vs. party data
Gong tracks call attendance (via calendar integration) separately from call participants (via recording metadata). A user may show 60+ "calls attended" in aggregate stats but only appear in party data for a subset of those calls. The stats tools are the reliable source for activity volume; call search finds calls where the person is an active participant in the recording.

### Action items
The Gong API's action items field is often empty even when calls clearly had follow-ups discussed. Key points and outline sections are more reliable sources for extracting next steps and commitments.
