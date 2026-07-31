import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/services/llmClient", () => ({
  chatComplete: vi.fn(),
}));

import { chatComplete } from "../src/services/llmClient";
import {
  generateBilan,
  BilanGenerationError,
} from "../src/services/bilanGenerator";
import { validBilanFixture } from "./fixtures/bilanFixture";

const mockedChatComplete = vi.mocked(chatComplete);

describe("generateBilan", () => {
  beforeEach(() => {
    mockedChatComplete.mockReset();
  });

  it("retourne le bilan parsé quand la réponse est valide du premier coup", async () => {
    mockedChatComplete.mockResolvedValueOnce(JSON.stringify(validBilanFixture));

    const bilan = await generateBilan("texte éducateur");

    expect(bilan.en_tete.beneficiaire_nom).toBe(
      validBilanFixture.en_tete.beneficiaire_nom
    );
    expect(mockedChatComplete).toHaveBeenCalledTimes(1);
  });

  it("retry une fois si le JSON est invalide, puis réussit", async () => {
    mockedChatComplete
      .mockResolvedValueOnce("ceci n'est pas du JSON")
      .mockResolvedValueOnce(JSON.stringify(validBilanFixture));

    const bilan = await generateBilan("texte éducateur");

    expect(bilan).toBeDefined();
    expect(mockedChatComplete).toHaveBeenCalledTimes(2);
  });

  it("retry une fois si un enum est hors liste, puis réussit", async () => {
    const invalidEnumBilan = {
      ...validBilanFixture,
      objectifs_intervention_periode: [
        { domaine_competence: "Domaine inventé", objectif: "x" },
      ],
    };
    mockedChatComplete
      .mockResolvedValueOnce(JSON.stringify(invalidEnumBilan))
      .mockResolvedValueOnce(JSON.stringify(validBilanFixture));

    const bilan = await generateBilan("texte éducateur");

    expect(bilan).toBeDefined();
    expect(mockedChatComplete).toHaveBeenCalledTimes(2);
  });

  it("échoue après le retry si la réponse reste invalide", async () => {
    mockedChatComplete.mockResolvedValue("toujours pas du JSON");

    await expect(generateBilan("texte éducateur")).rejects.toBeInstanceOf(
      BilanGenerationError
    );
    expect(mockedChatComplete).toHaveBeenCalledTimes(2);
  });

  it("injecte le contexte du bilan précédent dans le prompt utilisateur", async () => {
    mockedChatComplete.mockResolvedValueOnce(JSON.stringify(validBilanFixture));

    await generateBilan("texte éducateur", validBilanFixture);

    const messages = mockedChatComplete.mock.calls[0][0];
    const userMessage = messages.find((m) => m.role === "user");
    expect(userMessage?.content).toContain("bilan précédent");
    expect(userMessage?.content).toContain(
      validBilanFixture.proposition_objectifs_periode_suivante[0].objectif
    );
  });
});
