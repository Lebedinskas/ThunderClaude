import { useState, useEffect, useCallback } from "react";
import {
  type Goal,
  loadGoals,
  createGoal,
  updateGoal,
  deleteGoal,
} from "../../lib/goals";

interface GoalsPanelProps {
  onClose: () => void;
  onGoalsChange: () => void;
}

type Tab = "active" | "completed";
type EditMode = "progress" | "details";

export function GoalsPanel({ onClose, onGoalsChange }: GoalsPanelProps) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("active");
  const [addingGoal, setAddingGoal] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newTags, setNewTags] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState<EditMode>("progress");
  const [editProgress, setEditProgress] = useState(0);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editTags, setEditTags] = useState("");

  useEffect(() => {
    loadGoals()
      .then(setGoals)
      .catch(() => setGoals([]))
      .finally(() => setLoading(false));
  }, []);

  const activeGoals = goals.filter((g) => g.status === "active");
  const completedGoals = goals.filter(
    (g) => g.status === "completed" || g.status === "archived",
  );

  const parseTags = (raw: string): string[] =>
    raw.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return;
    const updated = await createGoal(goals, newName, newDesc, parseTags(newTags));
    setGoals(updated);
    setNewName("");
    setNewDesc("");
    setNewTags("");
    setAddingGoal(false);
    onGoalsChange();
  }, [goals, newName, newDesc, newTags, onGoalsChange]);

  const handleUpdateProgress = useCallback(
    async (id: string, progress: number) => {
      const updated = await updateGoal(goals, id, { progress });
      setGoals(updated);
      setEditingId(null);
      onGoalsChange();
    },
    [goals, onGoalsChange],
  );

  const handleUpdateDetails = useCallback(
    async (id: string) => {
      if (!editName.trim()) return;
      const updated = await updateGoal(goals, id, {
        name: editName.trim(),
        description: editDesc.trim(),
        tags: parseTags(editTags),
      });
      setGoals(updated);
      setEditingId(null);
      onGoalsChange();
    },
    [goals, editName, editDesc, editTags, onGoalsChange],
  );

  const handleComplete = useCallback(
    async (id: string) => {
      const updated = await updateGoal(goals, id, {
        status: "completed",
        progress: 100,
      });
      setGoals(updated);
      onGoalsChange();
    },
    [goals, onGoalsChange],
  );

  const handleReopen = useCallback(
    async (id: string) => {
      const updated = await updateGoal(goals, id, { status: "active" });
      setGoals(updated);
      onGoalsChange();
    },
    [goals, onGoalsChange],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      const updated = await deleteGoal(goals, id);
      setGoals(updated);
      onGoalsChange();
    },
    [goals, onGoalsChange],
  );

  const displayGoals = tab === "active" ? activeGoals : completedGoals;

  return (
    <div className="h-full flex flex-col bg-zinc-900">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-zinc-200">Goals</h2>
          {activeGoals.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-cyan-600/20 text-cyan-400">
              {activeGoals.length}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1.5 hover:bg-zinc-800 rounded-md transition-colors"
          title="Close"
        >
          <svg
            className="w-4 h-4 text-zinc-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      {/* Description */}
      <div className="px-4 py-2 border-b border-zinc-800/50">
        <p className="text-[11px] text-zinc-600 leading-relaxed">
          Track multi-session goals. Active goals are injected into the AI's
          context so it can help advance them.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-zinc-800/50">
        <button
          onClick={() => setTab("active")}
          className={`flex-1 px-4 py-2 text-[12px] font-medium transition-colors ${
            tab === "active"
              ? "text-orange-400 border-b-2 border-orange-500"
              : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          Active{activeGoals.length > 0 ? ` (${activeGoals.length})` : ""}
        </button>
        <button
          onClick={() => setTab("completed")}
          className={`flex-1 px-4 py-2 text-[12px] font-medium transition-colors ${
            tab === "completed"
              ? "text-orange-400 border-b-2 border-orange-500"
              : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          Done{completedGoals.length > 0 ? ` (${completedGoals.length})` : ""}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <span className="text-[12px] text-zinc-600">Loading...</span>
          </div>
        ) : displayGoals.length === 0 && !addingGoal ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <svg
              className="w-8 h-8 text-zinc-700 mb-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d={
                  tab === "active"
                    ? "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    : "M5 13l4 4L19 7"
                }
              />
            </svg>
            <p className="text-[12px] text-zinc-600 mb-1">
              {tab === "active" ? "No active goals" : "No completed goals"}
            </p>
            {tab === "active" && (
              <p className="text-[11px] text-zinc-700">
                Add a goal to track multi-session projects like "Learn Rust" or
                "Build portfolio site."
              </p>
            )}
          </div>
        ) : (
          <div className="py-1">
            {displayGoals.map((goal) => (
              <GoalItem
                key={goal.id}
                goal={goal}
                isEditing={editingId === goal.id}
                editMode={editMode}
                editProgress={editProgress}
                editName={editName}
                editDesc={editDesc}
                editTags={editTags}
                onStartProgressEdit={() => {
                  setEditingId(goal.id);
                  setEditMode("progress");
                  setEditProgress(goal.progress);
                }}
                onStartDetailsEdit={() => {
                  setEditingId(goal.id);
                  setEditMode("details");
                  setEditName(goal.name);
                  setEditDesc(goal.description);
                  setEditTags(goal.tags.join(", "));
                }}
                onProgressChange={setEditProgress}
                onNameChange={setEditName}
                onDescChange={setEditDesc}
                onTagsChange={setEditTags}
                onSaveProgress={() =>
                  handleUpdateProgress(goal.id, editProgress)
                }
                onSaveDetails={() => handleUpdateDetails(goal.id)}
                onCancelEdit={() => setEditingId(null)}
                onComplete={() => handleComplete(goal.id)}
                onReopen={() => handleReopen(goal.id)}
                onDelete={() => handleDelete(goal.id)}
              />
            ))}
          </div>
        )}

        {/* Add goal form — inline */}
        {addingGoal && (
          <div className="px-4 py-3 border-t border-zinc-800/50">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Goal name..."
              className="w-full px-2.5 py-1.5 rounded-md bg-zinc-800 border border-zinc-700/50 text-[12px] text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-cyan-600/50"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleCreate();
                }
                if (e.key === "Escape") setAddingGoal(false);
              }}
            />
            <textarea
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Description (optional)..."
              rows={2}
              className="w-full mt-1.5 px-2.5 py-1.5 rounded-md bg-zinc-800 border border-zinc-700/50 text-[12px] text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-cyan-600/50 resize-none"
            />
            <input
              value={newTags}
              onChange={(e) => setNewTags(e.target.value)}
              placeholder="Tags (comma-separated, optional)..."
              className="w-full mt-1.5 px-2.5 py-1.5 rounded-md bg-zinc-800 border border-zinc-700/50 text-[12px] text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-cyan-600/50"
            />
            <div className="flex items-center justify-end gap-1.5 mt-2">
              <button
                onClick={() => setAddingGoal(false)}
                className="px-2.5 py-1 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!newName.trim()}
                className="px-3 py-1 text-[11px] rounded-md bg-cyan-600 hover:bg-cyan-500 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Add Goal
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer — Add button */}
      {tab === "active" && !addingGoal && (
        <div className="px-4 py-2.5 border-t border-zinc-800/50">
          <button
            onClick={() => setAddingGoal(true)}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md border border-dashed border-zinc-700/50 text-[11px] text-zinc-500 hover:text-cyan-400 hover:border-cyan-600/30 transition-colors"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
            New Goal
          </button>
        </div>
      )}
    </div>
  );
}

// ── Goal Item ──────────────────────────────────────────────────────────────

interface GoalItemProps {
  goal: Goal;
  isEditing: boolean;
  editMode: EditMode;
  editProgress: number;
  editName: string;
  editDesc: string;
  editTags: string;
  onStartProgressEdit: () => void;
  onStartDetailsEdit: () => void;
  onProgressChange: (v: number) => void;
  onNameChange: (v: string) => void;
  onDescChange: (v: string) => void;
  onTagsChange: (v: string) => void;
  onSaveProgress: () => void;
  onSaveDetails: () => void;
  onCancelEdit: () => void;
  onComplete: () => void;
  onReopen: () => void;
  onDelete: () => void;
}

function GoalItem({
  goal,
  isEditing,
  editMode,
  editProgress,
  editName,
  editDesc,
  editTags,
  onStartProgressEdit,
  onStartDetailsEdit,
  onProgressChange,
  onNameChange,
  onDescChange,
  onTagsChange,
  onSaveProgress,
  onSaveDetails,
  onCancelEdit,
  onComplete,
  onReopen,
  onDelete,
}: GoalItemProps) {
  const isActive = goal.status === "active";

  // Details editing mode — inline form
  if (isEditing && editMode === "details") {
    return (
      <div className="px-4 py-3 border-b border-zinc-800/30 bg-zinc-800/20">
        <input
          value={editName}
          onChange={(e) => onNameChange(e.target.value)}
          className="w-full px-2.5 py-1.5 rounded-md bg-zinc-800 border border-zinc-700/50 text-[12px] text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-cyan-600/50"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSaveDetails();
            }
            if (e.key === "Escape") onCancelEdit();
          }}
        />
        <textarea
          value={editDesc}
          onChange={(e) => onDescChange(e.target.value)}
          placeholder="Description..."
          rows={2}
          className="w-full mt-1.5 px-2.5 py-1.5 rounded-md bg-zinc-800 border border-zinc-700/50 text-[12px] text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-cyan-600/50 resize-none"
        />
        <input
          value={editTags}
          onChange={(e) => onTagsChange(e.target.value)}
          placeholder="Tags (comma-separated)..."
          className="w-full mt-1.5 px-2.5 py-1.5 rounded-md bg-zinc-800 border border-zinc-700/50 text-[12px] text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-cyan-600/50"
        />
        <div className="flex items-center justify-end gap-1.5 mt-2">
          <button
            onClick={onCancelEdit}
            className="px-2.5 py-1 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onSaveDetails}
            disabled={!editName.trim()}
            className="px-3 py-1 text-[11px] rounded-md bg-cyan-600 hover:bg-cyan-500 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group px-4 py-2.5 hover:bg-zinc-800/30 transition-colors border-b border-zinc-800/30 last:border-b-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p
            className={`text-[12px] font-medium leading-tight ${
              isActive ? "text-zinc-300" : "text-zinc-500 line-through"
            }`}
          >
            {goal.name}
          </p>
          {goal.description && (
            <p className="text-[11px] text-zinc-600 mt-0.5 line-clamp-2 leading-snug">
              {goal.description}
            </p>
          )}
          {goal.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {goal.tags.map((tag) => (
                <span
                  key={tag}
                  className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Actions — visible on hover */}
        <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          {/* Edit button */}
          <button
            onClick={onStartDetailsEdit}
            className="p-1 rounded text-zinc-600 hover:text-cyan-400 transition-colors"
            title="Edit"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
            </svg>
          </button>
          {isActive ? (
            <button
              onClick={onComplete}
              className="p-1 rounded text-zinc-600 hover:text-emerald-400 transition-colors"
              title="Mark complete"
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </button>
          ) : (
            <button
              onClick={onReopen}
              className="p-1 rounded text-zinc-600 hover:text-cyan-400 transition-colors"
              title="Reopen"
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </button>
          )}
          <button
            onClick={onDelete}
            className="p-1 rounded text-zinc-600 hover:text-red-400 transition-colors"
            title="Delete"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Progress bar — active goals only */}
      {isActive && (
        <div className="mt-2">
          {isEditing && editMode === "progress" ? (
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={editProgress}
                onChange={(e) => onProgressChange(Number(e.target.value))}
                className="flex-1 h-1.5 accent-cyan-500"
              />
              <span className="text-[10px] text-cyan-400 font-mono w-8 text-right">
                {editProgress}%
              </span>
              <button
                onClick={onSaveProgress}
                className="text-[10px] text-cyan-400 hover:text-cyan-300 transition-colors"
              >
                Save
              </button>
              <button
                onClick={onCancelEdit}
                className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={onStartProgressEdit}
              className="w-full flex items-center gap-2 group/progress"
              title="Click to update progress"
            >
              <div className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-600 to-cyan-400 transition-all duration-300"
                  style={{ width: `${goal.progress}%` }}
                />
              </div>
              <span className="text-[10px] text-zinc-600 group-hover/progress:text-zinc-400 font-mono transition-colors">
                {goal.progress}%
              </span>
            </button>
          )}
        </div>
      )}

      {/* Completed date */}
      {goal.completedAt && (
        <p className="text-[10px] text-zinc-700 mt-1">
          Completed{" "}
          {new Date(goal.completedAt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })}
        </p>
      )}
    </div>
  );
}
