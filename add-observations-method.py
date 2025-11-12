#!/usr/bin/env python3
"""
Adds getTraceObservations method to langfuseClient.ts
"""

file_path = "src/services/langfuseClient.ts"

# Read the file
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Find the insertion point (before pushMetrics method)
marker = '''  /**
   * Push medical metrics as scores to a trace
   */
  async pushMetrics(traceId: string, metrics: MedicalMetrics): Promise<void> {'''

new_method = '''  /**
   * Get observations for a trace (to extract output if not in trace directly)
   */
  async getTraceObservations(traceId: string): Promise<any[]> {
    try {
      logger.debug(`Fetching observations for trace: ${traceId}`);

      const response = await this.fetchWithRetry(
        `${this.getBaseUrl()}/api/public/observations?traceId=${traceId}`,
        {
          method: 'GET',
          headers: this.getAuthHeaders(),
        }
      );

      const data = await response.json() as { data?: any[] };
      const observations = data.data || [];

      logger.debug(`Found ${observations.length} observations for trace ${traceId}`);
      return observations;
    } catch (error) {
      logger.error(`Failed to get observations for trace ${traceId}`, { error });
      return [];
    }
  }

  '''

if marker in content:
    content = content.replace(marker, new_method + marker)
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)
    print("[OK] Added getTraceObservations method to langfuseClient.ts")
else:
    print("[ERROR] Could not find insertion point")
