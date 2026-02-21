import { useState } from "react";
import {
  Skill,
  createSkill,
  saveSkills,
} from "../../lib/skills";

interface SkillsPanelProps {
  skills: Skill[];
  onSkillsChange: (skills: Skill[]) => void;
  onClose: () => void;
}

function SkillEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Skill;
  onSave: (name: string, description: string, content: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [content, setContent] = useState(initial?.content || "");

  const canSave = name.trim() && content.trim();

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <h3 className="text-sm font-medium text-zinc-200">
          {initial ? "Edit Skill" : "New Skill"}
        </h3>
        <button
          onClick={onCancel}
          className="p-1 hover:bg-zinc-800 rounded transition-colors"
        >
          <svg className="w-4 h-4 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div>
          <label className="block text-[11px] font-medium text-zinc-500 uppercase tracking-wider mb-1.5">
            Name
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Code Reviewer"
            className="w-full px-3 py-2 bg-zinc-800/80 border border-zinc-700 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-700/50 transition-colors"
          />
        </div>

        <div>
          <label className="block text-[11px] font-medium text-zinc-500 uppercase tracking-wider mb-1.5">
            Description
          </label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Short description of what this skill does"
            className="w-full px-3 py-2 bg-zinc-800/80 border border-zinc-700 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-700/50 transition-colors"
          />
        </div>

        <div>
          <label className="block text-[11px] font-medium text-zinc-500 uppercase tracking-wider mb-1.5">
            Instructions
          </label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="The system prompt instructions Claude will follow when this skill is active..."
            rows={10}
            className="w-full px-3 py-2 bg-zinc-800/80 border border-zinc-700 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-700/50 transition-colors resize-none leading-relaxed"
          />
        </div>
      </div>

      <div className="px-4 py-3 border-t border-zinc-800 flex items-center justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={() => canSave && onSave(name.trim(), description.trim(), content.trim())}
          disabled={!canSave}
          className={`px-4 py-1.5 text-sm rounded-lg transition-all ${
            canSave
              ? "bg-orange-600 hover:bg-orange-500 text-white"
              : "bg-zinc-800 text-zinc-600 cursor-not-allowed"
          }`}
        >
          Save
        </button>
      </div>
    </div>
  );
}

function SkillRow({
  skill,
  onToggle,
  onEdit,
  onDelete,
}: {
  skill: Skill;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [showMenu, setShowMenu] = useState(false);

  return (
    <div className="group px-4 py-3 hover:bg-zinc-800/40 transition-colors">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0 cursor-pointer" onClick={onEdit}>
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-zinc-200 truncate">
              {skill.name}
            </span>
            {skill.builtIn && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 uppercase tracking-wider shrink-0">
                Built-in
              </span>
            )}
          </div>
          {skill.description && (
            <p className="text-[12px] text-zinc-500 mt-0.5 line-clamp-2 leading-relaxed">
              {skill.description}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
          {/* Toggle */}
          <button
            onClick={onToggle}
            className={`relative w-8 h-[18px] rounded-full transition-colors ${
              skill.enabled ? "bg-orange-600" : "bg-zinc-700"
            }`}
          >
            <span
              className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow transition-transform ${
                skill.enabled ? "left-[16px]" : "left-[2px]"
              }`}
            />
          </button>

          {/* Menu */}
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="p-1 opacity-0 group-hover:opacity-100 hover:bg-zinc-700 rounded transition-all"
            >
              <svg className="w-3.5 h-3.5 text-zinc-500" fill="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="6" r="1.5" />
                <circle cx="12" cy="12" r="1.5" />
                <circle cx="12" cy="18" r="1.5" />
              </svg>
            </button>
            {showMenu && (
              <div className="absolute right-0 top-full mt-1 py-1 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl z-50 min-w-[100px]">
                <button
                  onClick={() => { onEdit(); setShowMenu(false); }}
                  className="w-full text-left px-3 py-1.5 text-[12px] text-zinc-300 hover:bg-zinc-700/50 transition-colors"
                >
                  Edit
                </button>
                {!skill.builtIn && (
                  <button
                    onClick={() => { onDelete(); setShowMenu(false); }}
                    className="w-full text-left px-3 py-1.5 text-[12px] text-red-400 hover:bg-zinc-700/50 transition-colors"
                  >
                    Delete
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function SkillsPanel({ skills, onSkillsChange, onClose }: SkillsPanelProps) {
  const [editing, setEditing] = useState<Skill | "new" | null>(null);
  const [search, setSearch] = useState("");

  const filtered = search
    ? skills.filter(
        (s) =>
          s.name.toLowerCase().includes(search.toLowerCase()) ||
          s.description.toLowerCase().includes(search.toLowerCase())
      )
    : skills;

  const activeCount = skills.filter((s) => s.enabled).length;

  const handleToggle = (id: string) => {
    const updated = skills.map((s) =>
      s.id === id ? { ...s, enabled: !s.enabled } : s
    );
    saveSkills(updated);
    onSkillsChange(updated);
  };

  const handleDelete = (id: string) => {
    const updated = skills.filter((s) => s.id !== id);
    saveSkills(updated);
    onSkillsChange(updated);
  };

  const handleSave = (name: string, description: string, content: string) => {
    let updated: Skill[];
    if (editing && editing !== "new") {
      // Edit existing
      updated = skills.map((s) =>
        s.id === editing.id ? { ...s, name, description, content } : s
      );
    } else {
      // Create new
      const newSkill = createSkill(name, description, content);
      updated = [...skills, newSkill];
    }
    saveSkills(updated);
    onSkillsChange(updated);
    setEditing(null);
  };

  // Editor sub-view
  if (editing) {
    return (
      <div className="h-full flex flex-col bg-zinc-900">
        <SkillEditor
          initial={editing === "new" ? undefined : editing}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
        />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-zinc-900">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-zinc-200">Skills</h2>
          {activeCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-600/20 text-orange-400">
              {activeCount} active
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setEditing("new")}
            className="p-1.5 hover:bg-zinc-800 rounded-md transition-colors"
            title="Add skill"
          >
            <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-zinc-800 rounded-md transition-colors"
            title="Close"
          >
            <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Description */}
      <div className="px-4 py-2 border-b border-zinc-800/50">
        <p className="text-[11px] text-zinc-600 leading-relaxed">
          Customizable instructions Claude follows in every message. Toggle skills on/off per conversation.
        </p>
      </div>

      {/* Search */}
      {skills.length > 4 && (
        <div className="px-4 py-2 border-b border-zinc-800/50">
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search skills..."
              className="w-full pl-8 pr-3 py-1.5 bg-zinc-800/50 border border-zinc-800 rounded-lg text-[12px] text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-zinc-700 transition-colors"
            />
          </div>
        </div>
      )}

      {/* Skills list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-[12px] text-zinc-600">
              {search ? "No skills match your search" : "No skills yet"}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/50">
            {filtered.map((skill) => (
              <SkillRow
                key={skill.id}
                skill={skill}
                onToggle={() => handleToggle(skill.id)}
                onEdit={() => setEditing(skill)}
                onDelete={() => handleDelete(skill.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
