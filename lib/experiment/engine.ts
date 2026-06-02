import {
  advanceExperimentHour,
  getActiveExperiment,
  getExperimentById,
  getFinalReports,
  getMainTurn,
  insertFinalReport,
  insertPrivateAnalysis,
  insertPublicEvent,
  logExperimentError,
  saveTelegramMessageId,
  updateExperimentStatus,
  type ExperimentRow
} from "@/lib/experiment/db";
import {
  generateFinalReport,
  generateJudgeReport,
  generateMainTurn,
  generateObserverResponse
} from "@/lib/experiment/ai";
import { buildFullPublicTranscript, buildPrivateAnalysesText } from "@/lib/experiment/transcript";
import type { AgentLabel, ObserverTarget } from "@/lib/experiment/schemas";
import {
  renderMainTelegramMessage,
  renderObserverTelegramMessage,
  sendTelegramMessage
} from "@/lib/telegram";

async function createMainTurn(experiment: ExperimentRow, agent: AgentLabel, latestAgentAMessage?: string) {
  const transcript = await buildFullPublicTranscript(experiment.id);
  const privateAnalyses = await buildPrivateAnalysesText(experiment.id, agent);
  const turn = await generateMainTurn({
    agent,
    hour: experiment.current_hour,
    transcript,
    privateAnalyses,
    latestAgentAMessage
  });

  const event = await insertPublicEvent({
    experimentId: experiment.id,
    hour: experiment.current_hour,
    eventType: "main_turn",
    agent,
    content: turn.publicMessage
  });

  await insertPrivateAnalysis({
    experimentId: experiment.id,
    publicEventId: event.id,
    hour: experiment.current_hour,
    agent,
    triggerType: "main_turn",
    analysis: turn.privateAnalysis
  });

  const messageId = await sendTelegramMessage(
    agent,
    renderMainTelegramMessage(agent, experiment.current_hour, turn.publicMessage)
  );
  await saveTelegramMessageId(event.id, messageId);

  return event;
}

export async function runNextHour() {
  const experiment = await getActiveExperiment();
  if (!experiment) {
    return { ok: false, reason: "No running experiment." };
  }

  if (experiment.current_hour > experiment.total_hours) {
    await finalizeExperiment(experiment.id);
    return { ok: true, finalized: true };
  }

  try {
    let agentAEvent = await getMainTurn(experiment.id, experiment.current_hour, "A");
    if (!agentAEvent) {
      agentAEvent = await createMainTurn(experiment, "A");
    }

    let agentBEvent = await getMainTurn(experiment.id, experiment.current_hour, "B");
    if (!agentBEvent) {
      agentBEvent = await createMainTurn(experiment, "B", agentAEvent.content);
    }

    await advanceExperimentHour(experiment.id, experiment.current_hour);

    if (experiment.current_hour >= experiment.total_hours) {
      await finalizeExperiment(experiment.id);
    }

    return { ok: true, hour: experiment.current_hour };
  } catch (error) {
    await logExperimentError(experiment.id, "Hourly turn failed", serializeError(error));
    return { ok: false, reason: "Hourly turn failed." };
  }
}

export async function handleObserverMessage(input: {
  experimentId: string;
  username: string;
  target: ObserverTarget;
  message: string;
}) {
  const observerEvent = await insertPublicEvent({
    experimentId: input.experimentId,
    eventType: "observer_message",
    observerUsername: input.username,
    observerTarget: input.target,
    content: input.message
  });

  const targets: AgentLabel[] = input.target === "both" ? ["A", "B"] : [input.target];
  const responses = [];

  for (const agent of targets) {
    const transcript = await buildFullPublicTranscript(input.experimentId);
    const privateAnalyses = await buildPrivateAnalysesText(input.experimentId, agent);
    const response = await generateObserverResponse({
      agent,
      hour: (await getExperimentById(input.experimentId))?.current_hour ?? 1,
      target: input.target,
      observerUsername: input.username,
      observerMessage: input.message,
      transcript,
      privateAnalyses
    });

    const responseEvent = await insertPublicEvent({
      experimentId: input.experimentId,
      eventType: "observer_response",
      agent,
      observerUsername: input.username,
      observerTarget: input.target,
      content: response.publicResponse,
      metadata: { observerEventId: observerEvent.id }
    });

    await insertPrivateAnalysis({
      experimentId: input.experimentId,
      publicEventId: responseEvent.id,
      agent,
      triggerType: "observer_response",
      analysis: response.privateAnalysis
    });

    const messageId = await sendTelegramMessage(
      agent,
      renderObserverTelegramMessage(agent, input.username, response.publicResponse)
    );
    await saveTelegramMessageId(responseEvent.id, messageId);
    responses.push(responseEvent);
  }

  return responses;
}

export async function finalizeExperiment(experimentId: string) {
  const transcript = await buildFullPublicTranscript(experimentId);

  const agentAPrivate = await buildPrivateAnalysesText(experimentId, "A");
  const agentAReport = await generateFinalReport({
    agent: "A",
    transcript,
    privateAnalyses: agentAPrivate
  });
  await insertFinalReport({ experimentId, reportType: "agent_a", report: agentAReport });
  await insertPrivateAnalysis({
    experimentId,
    agent: "A",
    triggerType: "final_report",
    analysis: agentAReport
  });

  const agentBPrivate = await buildPrivateAnalysesText(experimentId, "B");
  const agentBReport = await generateFinalReport({
    agent: "B",
    transcript,
    privateAnalyses: agentBPrivate
  });
  await insertFinalReport({ experimentId, reportType: "agent_b", report: agentBReport });
  await insertPrivateAnalysis({
    experimentId,
    agent: "B",
    triggerType: "final_report",
    analysis: agentBReport
  });

  const allPrivate = await buildPrivateAnalysesText(experimentId);
  const reports = await getFinalReports(experimentId);
  const judgeReport = await generateJudgeReport({
    transcript,
    privateAnalyses: allPrivate,
    finalReports: JSON.stringify(reports, null, 2)
  });
  await insertFinalReport({ experimentId, reportType: "judge", report: judgeReport });

  await updateExperimentStatus(experimentId, "completed");
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }

  return { error };
}
