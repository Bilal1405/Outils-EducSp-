import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/services/ollamaClient", () => ({
  ollamaChat: vi.fn(),
}));

import { ollamaChat } from "../src/services/ollamaClient";
import {
  generateBilan,
  BilanGenerationError,
} from "../src/services/bilanGenerator";
import { validBilanFixture } from "./fixtures/bilanFixture";

const mockedOllamaChat = vi.mocked(ollamaChat);

describe("generateBilan", () => {
  beforeEach(() => {
    mockedOllamaChat.mockReset();
  });

  it("retourne le bilan parsé quand la réponse est valide du premier coup", async () => {
    mockedOllamaChat.mockResolvedValueOnce(JSON.stringify(validBilanFixture));

    const bilan = await generateBilan("texte éducateur");

    expect(bilan.en_tete.beneficiaire_nom).toBe(
      validBilanFixture.en_tete.beneficiaire_nom
    );
    expect(mockedOllamaChat).toHaveBeenCalledTimes(1);
  });

  it("retry une fois si le JSON est invalide, puis réussit", async () => {
    mockedOllamaChat
      .mockResolvedValueOnce("ceci n'est pas du JSON")
      .mockResolvedValueOnce(JSON.stringify(validBilanFixture));

    const bilan = await generateBilan("texte éducateur");

    expect(bilan).toBeDefined();
    expect(mockedOllamaChat).toHaveBeenCalledTimes(2);
  });

  it("retry une fois si un enum est hors liste, puis réussit", async () => {
    const invalidEnumBilan = {
      ...validBilanFixture,
      objectifs_intervention_periode: [
        { domaine_competence: "Domaine inventé", objectif: "x" },
      ],
    };
    mockedOllamaChat
      .mockResolvedValueOnce(JSON.stringify(invalidEnumBilan))
      .mockResolvedValueOnce(JSON.stringify(validBilanFixture));

    const bilan = await generateBilan("texte éducateur");

    expect(bilan).toBeDefined();
    expect(mockedOllamaChat).toHaveBeenCalledTimes(2);
  });

  it("échoue après le retry si la réponse reste invalide", async () => {
    mockedOllamaChat.mockResolvedValue("toujours pas du JSON");

    await expect(generateBilan("texte éducateur")).rejects.toBeInstanceOf(
      BilanGenerationError
    );
    expect(mockedOllamaChat).toHaveBeenCalledTimes(2);
  });

  it("injecte le contexte du bilan précédent dans le prompt utilisateur", async () => {
    mockedOllamaChat.mockResolvedValueOnce(JSON.stringify(validBilanFixture));

    await generateBilan("texte éducateur", validBilanFixture);

    const messages = mockedOllamaChat.mock.calls[0][0];
    const userMessage = messages.find((m) => m.role === "user");
    expect(userMessage?.content).toContain("bilan précédent");
    expect(userMessage?.content).toContain(
      validBilanFixture.proposition_objectifs_periode_suivante[0].objectif
    );
  });
});
