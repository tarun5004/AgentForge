"use client";

import { GripHorizontal, GripVertical } from "lucide-react";
import { Separator } from "react-resizable-panels";

type ResizeHandleProps = {
  direction: "horizontal" | "vertical";
};

export function ResizeHandle({ direction }: ResizeHandleProps) {
  const isHorizontal = direction === "horizontal";

  return (
    <Separator
      className={`group flex shrink-0 items-center justify-center bg-[#181819] transition-colors hover:bg-[#303034] focus-visible:bg-[#303034] focus-visible:outline-none ${
        isHorizontal ? "h-full w-1.5" : "h-1.5 w-full"
      }`}
    >
      {/* The grip shows users that this thin separator can be dragged. */}
      {isHorizontal ? (
        <GripVertical size={10} className="text-[#59595e] group-hover:text-[#b0b0b5]" />
      ) : (
        <GripHorizontal size={10} className="text-[#59595e] group-hover:text-[#b0b0b5]" />
      )}
    </Separator>
  );
}
