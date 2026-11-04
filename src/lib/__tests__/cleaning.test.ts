import { describe, it, expect } from "vitest";
import { addCleaningShifts } from "../cleaning";
import { validateSchedule } from "../validation";
import { applyMigrations } from "../migrations";
import { initialScheduleFor, storeById } from "../stores";
import type { Employee, Shift } from "../../types";
const employee: Employee = { id: "a", name: "A", employmentType: "TEILZEIT", targetMinutes: 300, cleaningEnabled: true, cleaningHoursPerMonth: 2 };
const shift = (start: number, end: number, id = "a"): Shift => ({ id: `${id}-${start}`, employeeId: id, date: "2026-11-03", startMinutes: start, endMinutes: end, paidMinutes: end-start, pauseMinutes: 0, shiftType: "CUSTOM", generated: true });
describe("cleaning", () => {
 it("adds 08–10 to 12–14 and 17–20, preserves service shifts", () => {
  const service = [shift(720,840), shift(1020,1200)];
  const result = addCleaningShifts([employee], service);
  expect(result.filter(s => s.task === "CLEANING")).toMatchObject([{ startMinutes: 480, endMinutes: 600, paidMinutes: 120 }]);
  expect(result.filter(s => !s.task)).toEqual(service);
  expect(validateSchedule([employee], result).errors).toEqual([]);
 });
 it("respects capacity and reports missing hours", () => {
  const service = [shift(660,1020), shift(1080,1260)];
  const result = addCleaningShifts([employee], service);
  expect(result).toEqual(service);
  expect(validateSchedule([employee], result).errors.some(e => e.message.includes("vệ sinh"))).toBe(true);
 });
 it("does not double book cleaning, rejects days off", () => {
  const b = { ...employee, id: "b" };
  const result = addCleaningShifts([employee,b], [shift(720,840), shift(720,840,"b")]);
  const cleaning = result.filter(s => s.task === "CLEANING");
  expect(cleaning).toHaveLength(2);
  expect(cleaning[0].endMinutes).toBeLessThanOrEqual(cleaning[1].startMinutes);
  expect(addCleaningShifts([{...employee, vacationDates: ["2026-11-03"]}], [shift(720,840)])).toHaveLength(1);
 });
 it("opens Monday once, then preserves later settings", () => {
  const initial = initialScheduleFor(storeById("vietcuisine"));
  const migrated = applyMigrations("vietcuisine", initial);
  expect(migrated.workHours.closedWeekdays.monday).toBe(false);
  expect(migrated.workHours.perWeekday.monday).toEqual([{startMinutes:720,endMinutes:840},{startMinutes:1050,endMinutes:1290}]);
  expect(applyMigrations("vietcuisine", migrated)).toBe(migrated);
 });
});
