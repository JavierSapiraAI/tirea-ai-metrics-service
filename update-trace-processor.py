#!/usr/bin/env python3
"""
Updates traceProcessor.ts to fetch observations when trace.output is null
"""

file_path = "src/services/traceProcessor.ts"

# Read the file
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Find and replace the processTrace method's extraction logic
old_code = '''      // Extract AI extraction data from trace output
      const extraction = this.metricsCalculator.extractDataFromTrace(trace.output);

      if (!extraction) {
        logger.warn(`Failed to extract data from trace ${trace.id}, skipping`);
        return false;
      }'''

new_code = '''      // Extract AI extraction data from trace output
      let traceOutput = trace.output;

      // If trace.output is null, fetch observations to get the generation output
      if (!traceOutput) {
        logger.debug(`Trace ${trace.id} has no direct output, fetching observations...`);
        const observations = await this.langfuseClient.getTraceObservations(trace.id);

        // Find the first GENERATION type observation
        const generationObs = observations.find((obs: any) => obs.type === 'GENERATION');

        if (generationObs && generationObs.output) {
          traceOutput = generationObs.output;
          logger.debug(`Found output in generation observation for trace ${trace.id}`);
        } else {
          logger.warn(`No generation observation with output found for trace ${trace.id}, skipping`);
          return false;
        }
      }

      const extraction = this.metricsCalculator.extractDataFromTrace(traceOutput);

      if (!extraction) {
        logger.warn(`Failed to extract data from trace ${trace.id}, skipping`);
        return false;
      }'''

if old_code in content:
    content = content.replace(old_code, new_code)
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)
    print("[OK] Updated traceProcessor.ts to fetch observations")
else:
    print("[ERROR] Could not find code to replace")
    print("The file may have been modified")
